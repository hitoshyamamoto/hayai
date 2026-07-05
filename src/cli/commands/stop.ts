import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

export const stopCommand = new Command('stop')
  .description('Stop database instances')
  .argument('[name]', 'Database instance name (optional, stops all if not specified)')
  .option('-a, --all', 'Stop all database instances (explicit form of omitting the name)')
  .option('--json', 'Machine-readable JSON output on stdout')
  .action(async (name: string, options: { all?: boolean; json?: boolean }) => {
    const jsonMode = Boolean(options.json);
    try {
      if (name && options.all) {
        fail('stop', ExitCode.Usage, 'Pass a name or --all, not both', jsonMode);
      }

      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      if (name) {
        if (!dockerManager.getInstance(name)) {
          fail(
            'stop',
            ExitCode.NotFound,
            `Database instance '${name}' not found`,
            jsonMode,
            'Run `hayai list` to see available databases',
          );
        }

        const spinner = jsonMode ? null : ora(`Stopping database '${name}'...`).start();
        await dockerManager.stopDatabase(name);
        spinner?.succeed(`Database '${name}' stopped successfully`);
        succeed('stop', { stopped: [name] }, jsonMode);
      } else {
        const spinner = jsonMode ? null : ora('Stopping all databases...').start();
        await dockerManager.stopAllDatabases();
        spinner?.succeed('All databases stopped successfully');
        succeed(
          'stop',
          {
            stopped: dockerManager
              .getAllInstances()
              .filter((instance) => instance.status === 'stopped')
              .map((instance) => instance.name),
          },
          jsonMode,
        );
      }

      if (!jsonMode) {
        console.log(chalk.green('\n✅ Database(s) stopped!'));
        console.log(chalk.yellow('💡 Run `hayai list` to see current status'));
      }
    } catch (error) {
      failFromError('stop', error, jsonMode);
    }
  });
