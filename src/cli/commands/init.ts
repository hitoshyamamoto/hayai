import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { getTemplate, getAvailableTypes, getEnginesByType } from '../../core/templates.js';
import { createDatabase } from '../../core/docker.js';
import { InitOptions } from '../../core/types.js';

// Map technical types to user-friendly display names
const getDisplayName = (type: string): string => {
  const displayNames: Record<string, string> = {
    'sql': 'SQL',
    'keyvalue': 'Key-Value',
    'widecolumn': 'Wide Column',
    'timeseries': 'Time Series',
    'vector': 'Vector',
    'graph': 'Graph',
    'search': 'Search',
    'embedded': 'Embedded',
  };
  return displayNames[type] || type.toUpperCase();
};

export const initCommand = new Command('init')
  .description('Initialize a new database instance')
  .option('-n, --name <name>', 'Database instance name')
  .option('-e, --engine <engine>', 'Database engine (postgresql, mariadb, redis, etc.)')
  .option('-p, --port <port>', 'Custom port number', parseInt)
  .option('--admin-dashboard', 'Enable admin dashboard')
  .option('--no-admin-dashboard', 'Disable admin dashboard')
  .option('--client-sdk', 'Generate client SDK')
  .option('--no-client-sdk', 'Skip client SDK generation')
  .option('--language <language>', 'Programming language for client SDK')
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .action(async (options: InitOptions) => {
    try {
      const spinner = ora('Initializing database...').start();
      
      let config: {
        name: string;
        engine: string;
        port?: number;
        adminDashboard: boolean;
        clientSdk: boolean;
        language?: string;
      };

      if (options.yes && options.name && options.engine) {
        // Non-interactive mode
        config = {
          name: options.name,
          engine: options.engine,
          port: options.port,
          adminDashboard: options.adminDashboard ?? true,
          clientSdk: options.clientSdk ?? false,
          language: options.language,
        };
        spinner.stop();
      } else {
        // Interactive mode
        spinner.stop();
        console.log(chalk.cyan('\n🚀 Let\'s set up your database!\n'));
        
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
            choices: availableTypes.map(type => ({
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
              return engines.map(engine => {
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
            filter: (input: string) => input ? parseInt(input) : undefined,
          },
          {
            type: 'confirm',
            name: 'adminDashboard',
            message: 'Enable admin dashboard?',
            default: options.adminDashboard ?? true,
          },
          {
            type: 'confirm',
            name: 'clientSdk',
            message: 'Generate client SDK?',
            default: options.clientSdk ?? false,
          },
          {
            type: 'list',
            name: 'language',
            message: 'Which programming language?',
            choices: ['typescript', 'javascript', 'python'],
            default: options.language || 'typescript',
            when: (answers: any) => answers.clientSdk,
          },
        ]);

        config = {
          name: answers.name,
          engine: options.engine || answers.engine,
          port: answers.port,
          adminDashboard: answers.adminDashboard,
          clientSdk: answers.clientSdk,
          language: answers.language,
        };
      }

      // Get the database template
      const template = getTemplate(config.engine);
      if (!template) {
        throw new Error(`Database engine '${config.engine}' is not supported`);
      }

      // Create the database instance
      const createSpinner = ora(`Creating ${template.name} instance '${config.name}'...`).start();
      
      const instance = await createDatabase(config.name, template, {
        port: config.port,
        adminDashboard: config.adminDashboard,
      });

      createSpinner.succeed(`Successfully created ${template.name} instance '${config.name}'`);

      // Display success information
      console.log(chalk.green('\n✅ Database instance created successfully!\n'));
      console.log(chalk.bold('Instance Details:'));
      console.log(`  Name: ${chalk.cyan(instance.name)}`);
      console.log(`  Engine: ${chalk.cyan(template.name)} (${template.engine.image})`);
      console.log(`  Port: ${chalk.cyan(instance.port)}`);
      console.log(`  Connection URI: ${chalk.cyan(instance.connection_uri)}`);
      console.log(`  Data Volume: ${chalk.gray(instance.volume)}`);
      
      if (template.admin_dashboard?.enabled) {
        console.log(`  Admin Dashboard: run ${chalk.cyan(`hayai studio ${instance.name}`)} once started`);
      }

      console.log(chalk.yellow('\n📋 Next Steps:'));
      console.log(`  1. Run ${chalk.cyan('hayai start')} to start your database`);
      console.log(`  2. Run ${chalk.cyan('hayai list')} to see all your databases`);
      console.log(`  3. Run ${chalk.cyan('hayai studio')} to open admin dashboards`);
      console.log(`  4. Check your ${chalk.cyan('.env')} file for connection details`);

      if (config.clientSdk) {
        console.log(`  5. Find your client SDK in ${chalk.cyan('./client/')} directory`);
      }

    } catch (error) {
      console.error(chalk.red('\n❌ Failed to initialize database:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }); 