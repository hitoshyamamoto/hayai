import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  getTemplate,
  getAvailableTypes,
  getEnginesByType,
  getOpenSourceInfo,
} from '../../core/templates.js';
import { createDatabase, getDockerManager } from '../../core/docker.js';
import { InitOptions } from '../../core/types.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

// Map technical types to user-friendly display names
const getDisplayName = (type: string): string => {
  const displayNames: Record<string, string> = {
    sql: 'SQL',
    keyvalue: 'Key-Value',
    widecolumn: 'Wide Column',
    timeseries: 'Time Series',
    vector: 'Vector',
    graph: 'Graph',
    search: 'Search',
    embedded: 'Embedded',
    analytics: 'Analytics',
    document: 'Document',
  };
  return displayNames[type] || type.toUpperCase();
};

interface InitCommandOptions extends InitOptions {
  existsOk?: boolean;
  json?: boolean;
}

export const initCommand = new Command('init')
  .description('Initialize a new database instance')
  .option('-n, --name <name>', 'Database instance name')
  .option('-e, --engine <engine>', 'Database engine (postgresql, mariadb, redis, etc.)')
  .option('-p, --port <port>', 'Custom port number', parseInt)
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .option(
    '--exists-ok',
    'Exit 0 without changes if an instance with this name and engine already exists',
  )
  .option('--json', 'Machine-readable JSON output on stdout (implies non-interactive)')
  .action(async (options: InitCommandOptions) => {
    const jsonMode = Boolean(options.json);
    try {
      // --json is a promise to never block on a prompt: with the required
      // inputs missing there is nothing valid to do but refuse.
      if (jsonMode && (!options.name || !options.engine)) {
        fail(
          'init',
          ExitCode.Usage,
          '--json requires --name and --engine (prompts are disabled)',
          jsonMode,
        );
      }

      let config: {
        name: string;
        engine: string;
        port?: number;
      };

      if ((options.yes || jsonMode) && options.name && options.engine) {
        // Non-interactive mode
        config = {
          name: options.name,
          engine: options.engine,
          port: options.port,
        };
      } else {
        // Interactive mode
        console.log(chalk.cyan("\n🚀 Let's set up your database!\n"));

        const availableTypes = getAvailableTypes();

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'What would you like to name your database instance?',
            default: options.name || 'my-database',
            validate: (input: string) => {
              if (!input || input.trim().length === 0) {
                return 'Please enter a valid name';
              }
              if (!/^[a-zA-Z0-9-_]+$/.test(input)) {
                return 'Name can only contain letters, numbers, hyphens, and underscores';
              }
              return true;
            },
          },
          {
            type: 'list',
            name: 'type',
            message: 'What type of database do you need?',
            choices: availableTypes.map((type) => ({
              name: `${getDisplayName(type)} (${getEnginesByType(type).join(', ')})`,
              value: type,
            })),
            when: !options.engine,
          },
          {
            type: 'list',
            name: 'engine',
            message: 'Which database engine would you like to use?',
            choices: (answers: any) => {
              const engines = options.engine ? [options.engine] : getEnginesByType(answers.type);
              return engines.map((engine) => {
                const template = getTemplate(engine);
                return {
                  name: `${template?.name} (${template?.engine.image})`,
                  value: engine,
                };
              });
            },
            when: !options.engine,
          },
          {
            type: 'input',
            name: 'port',
            message: 'Custom port number (leave empty for auto-allocation):',
            default: options.port,
            validate: (input: string) => {
              if (!input) return true;
              const port = parseInt(input);
              if (isNaN(port) || port < 1024 || port > 65535) {
                return 'Please enter a valid port number (1024-65535)';
              }
              return true;
            },
            filter: (input: string) => (input ? parseInt(input) : undefined),
          },
        ]);

        config = {
          name: answers.name,
          engine: options.engine || answers.engine,
          port: answers.port,
        };
      }

      // Get the database template
      const template = getTemplate(config.engine);
      if (!template) {
        fail(
          'init',
          ExitCode.Usage,
          `Database engine '${config.engine}' is not supported`,
          jsonMode,
          'Run `hayai init` without flags to browse the supported engines',
        );
      }

      // Idempotency: an orchestrator retry must not explode on its own success.
      const dockerManager = getDockerManager();
      await dockerManager.initialize();
      const existing = dockerManager.getInstance(config.name);
      if (existing) {
        if (options.existsOk && existing.engine === config.engine) {
          if (!jsonMode) {
            console.log(
              chalk.gray(`ℹ️  Instance '${config.name}' (${existing.engine}) already exists — ok`),
            );
          }
          succeed('init', { created: false, instance: existing }, jsonMode);
          return;
        }
        const detail =
          existing.engine === config.engine
            ? `Instance '${config.name}' already exists`
            : `Instance '${config.name}' already exists with a different engine (${existing.engine})`;
        fail(
          'init',
          ExitCode.Conflict,
          detail,
          jsonMode,
          options.existsOk ? undefined : 'Use --exists-ok for idempotent creation',
        );
      }

      if (template.experimental && !jsonMode) {
        console.log(
          chalk.yellow(
            `\n⚠️  ${template.name} is experimental: hayai runs it as a single container, but it needs a multi-node cluster to work properly. Expect it to be partially or non-functional.`,
          ),
        );
      }

      // Source-available engines (TimescaleDB, MongoDB) are documented
      // exceptions to the open-source catalog — say so at the moment of use.
      const licenseInfo = getOpenSourceInfo()[config.engine];
      if (licenseInfo && !licenseInfo.fullyOpenSource && !jsonMode) {
        console.log(
          chalk.yellow(
            `\nℹ️  ${template.name} is source-available, not OSI open source (${licenseInfo.license}). ${licenseInfo.notes}`,
          ),
        );
      }

      // Create the database instance
      const createSpinner = jsonMode
        ? null
        : ora(`Creating ${template.name} instance '${config.name}'...`).start();

      let instance;
      try {
        instance = await createDatabase(config.name, template, {
          port: config.port,
        });
      } catch (error) {
        createSpinner?.fail(`Failed to create '${config.name}'`);
        // A concurrent process may have created the same name between our
        // check and the locked create — map that race to the same contract.
        if (error instanceof Error && error.message.includes('already exists')) {
          if (options.existsOk) {
            const raced = getDockerManager().getInstance(config.name);
            if (raced && raced.engine === config.engine) {
              succeed('init', { created: false, instance: raced }, jsonMode);
              return;
            }
          }
          fail('init', ExitCode.Conflict, error.message, jsonMode);
        }
        throw error;
      }

      createSpinner?.succeed(`Successfully created ${template.name} instance '${config.name}'`);

      if (jsonMode) {
        succeed(
          'init',
          { created: true, instance, experimental: Boolean(template.experimental) },
          jsonMode,
        );
        return;
      }

      // Display success information
      console.log(chalk.green('\n✅ Database instance created successfully!\n'));
      console.log(chalk.bold('Instance Details:'));
      console.log(`  Name: ${chalk.cyan(instance.name)}`);
      console.log(`  Engine: ${chalk.cyan(template.name)} (${template.engine.image})`);
      console.log(`  Port: ${chalk.cyan(instance.port)}`);
      console.log(`  Connection URI: ${chalk.cyan(instance.connection_uri)}`);
      console.log(`  Data Volume: ${chalk.gray(instance.volume)}`);

      if (template.admin_dashboard?.enabled) {
        console.log(
          `  Admin Dashboard: run ${chalk.cyan(`hayai studio ${instance.name}`)} once started`,
        );
      }

      console.log(chalk.yellow('\n📋 Next Steps:'));
      console.log(`  1. Run ${chalk.cyan('hayai start')} to start your database`);
      console.log(`  2. Run ${chalk.cyan('hayai list')} to see all your databases`);
      console.log(`  3. Run ${chalk.cyan('hayai studio')} to open admin dashboards`);
    } catch (error) {
      failFromError('init', error, jsonMode);
    }
  });
