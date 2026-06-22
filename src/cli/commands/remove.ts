import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { recordOperation } from '../../core/security.js';

export const removeCommand = new Command('remove')
  .description('Remove a database instance')
  .argument('<name>', 'Database instance name')
  .option('-f, --force', 'Force removal without confirmation')
  .option('--keep-data', 'Keep the data volume')
  .action(async (name: string, options) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      const instance = dockerManager.getInstance(name);
      if (!instance) {
        console.error(chalk.red(`❌ Database instance '${name}' not found`));
        process.exit(1);
      }

      // Confirmation prompt
      if (!options.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Are you sure you want to remove '${name}'? This action cannot be undone.`,
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.yellow('Operation cancelled'));
          return;
        }
      }

      const spinner = ora(`Removing database '${name}'...`).start();

      // Stop the database if it's running
      if (instance.status === 'running') {
        spinner.text = `Stopping database '${name}'...`;
        await dockerManager.stopDatabase(name);
      }

      // Remove the database
      await dockerManager.removeDatabase(name, { keepData: options.keepData });
      await recordOperation({ operation: 'remove', source: name, success: true });

      spinner.succeed(`Database '${name}' removed successfully`);

      console.log(chalk.green('\n✅ Database removed!'));
      if (options.keepData) {
        console.log(chalk.yellow(`💡 Data volume kept at: ${instance.volume}`));
      }
      console.log(chalk.yellow('💡 Run `hayai list` to see remaining databases'));

    } catch (error) {
      await recordOperation({
        operation: 'remove',
        source: name,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
      console.error(chalk.red('\n❌ Failed to remove database:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }); 