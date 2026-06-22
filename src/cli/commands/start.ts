import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';

export const startCommand = new Command('start')
  .description('Start database instances')
  .argument('[name]', 'Database instance name (optional, starts all if not specified)')
  .option('-a, --all', 'Start all database instances')
  .action(async (name: string) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      if (name) {
        // Start specific database
        const spinner = ora(`Starting database '${name}'...`).start();
        await dockerManager.startDatabase(name);
        spinner.succeed(`Database '${name}' started successfully`);
      } else {
        // Start all databases
        const spinner = ora('Starting all databases...').start();
        await dockerManager.startAllDatabases();
        spinner.succeed('All databases started successfully');
      }

      console.log(chalk.green('\n✅ Database(s) started!'));
      console.log(chalk.yellow('💡 Run `hayai list` to see running instances'));
      console.log(chalk.yellow('💡 Run `hayai studio` to open admin dashboards'));
    } catch (error) {
      console.error(
        chalk.red('\n❌ Failed to start database(s):'),
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  });
