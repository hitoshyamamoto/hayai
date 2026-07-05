import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

export const startCommand = new Command('start')
  .description('Start database instances')
  .argument('[name]', 'Database instance name (optional, starts all if not specified)')
  .option('-a, --all', 'Start all database instances (explicit form of omitting the name)')
  .option('--json', 'Machine-readable JSON output on stdout')
  .action(async (name: string, options: { all?: boolean; json?: boolean }) => {
    const jsonMode = Boolean(options.json);
    try {
      if (name && options.all) {
        fail('start', ExitCode.Usage, 'Pass a name or --all, not both', jsonMode);
      }

      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      if (name) {
        if (!dockerManager.getInstance(name)) {
          fail(
            'start',
            ExitCode.NotFound,
            `Database instance '${name}' not found`,
            jsonMode,
            'Run `hayai list` to see available databases',
          );
        }

        const spinner = jsonMode ? null : ora(`Starting database '${name}'...`).start();
        await dockerManager.startDatabase(name);
        spinner?.succeed(`Database '${name}' started successfully`);
        succeed('start', { started: [name] }, jsonMode);
      } else {
        const spinner = jsonMode ? null : ora('Starting all databases...').start();
        await dockerManager.startAllDatabases();
        spinner?.succeed('All databases started successfully');
        succeed(
          'start',
          {
            started: dockerManager
              .getAllInstances()
              .filter((instance) => instance.status === 'running')
              .map((instance) => instance.name),
          },
          jsonMode,
        );
      }

      if (!jsonMode) {
        console.log(chalk.green('\n✅ Database(s) started!'));
        console.log(chalk.yellow('💡 Run `hayai list` to see running instances'));
        console.log(chalk.yellow('💡 Run `hayai studio` to open admin dashboards'));
      }
    } catch (error) {
      failFromError('start', error, jsonMode);
    }
  });
