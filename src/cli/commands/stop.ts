import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';

export const stopCommand = new Command('stop')
  .description('Stop database instances')
  .argument('[name]', 'Database instance name (optional, stops all if not specified)')
  .option('-a, --all', 'Stop all database instances')
  .action(async (name: string) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      if (name) {
        // Stop specific database
        const spinner = ora(`Stopping database '${name}'...`).start();
        await dockerManager.stopDatabase(name);
        spinner.succeed(`Database '${name}' stopped successfully`);
      } else {
        // Stop all databases
        const spinner = ora('Stopping all databases...').start();
        await dockerManager.stopAllDatabases();
        spinner.succeed('All databases stopped successfully');
      }

      console.log(chalk.green('\n✅ Database(s) stopped!'));
      console.log(chalk.yellow('💡 Run `hayai list` to see current status'));
    } catch (error) {
      console.error(
        chalk.red('\n❌ Failed to stop database(s):'),
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  });
