import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { recordOperation } from '../../core/security.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

interface RemoveCommandOptions {
  force?: boolean;
  keepData?: boolean;
  missingOk?: boolean;
  json?: boolean;
}

export const removeCommand = new Command('remove')
  .description('Remove a database instance')
  .argument('<name>', 'Database instance name')
  .option('-f, --force', 'Force removal without confirmation')
  .option('--keep-data', 'Keep the data volume')
  .option('--missing-ok', 'Exit 0 without changes if the instance does not exist')
  .option('--json', 'Machine-readable JSON output on stdout (implies non-interactive)')
  .action(async (name: string, options: RemoveCommandOptions) => {
    const jsonMode = Boolean(options.json);
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      const instance = dockerManager.getInstance(name);
      if (!instance) {
        // Idempotency: a retried teardown that finds nothing to tear down
        // has succeeded, not failed.
        if (options.missingOk) {
          if (!jsonMode) {
            console.log(chalk.gray(`ℹ️  Instance '${name}' does not exist — ok`));
          }
          succeed('remove', { removed: false, name }, jsonMode);
          return;
        }
        fail(
          'remove',
          ExitCode.NotFound,
          `Database instance '${name}' not found`,
          jsonMode,
          'Use --missing-ok for idempotent removal',
        );
      }

      // Confirmation prompt. --json promises non-interactivity, so without
      // --force it refuses instead of hanging an orchestrator on a prompt.
      if (!options.force) {
        if (jsonMode) {
          fail(
            'remove',
            ExitCode.Precondition,
            'Removal requires confirmation: pass --force with --json',
            jsonMode,
          );
        }
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

      const spinner = jsonMode ? null : ora(`Removing database '${name}'...`).start();

      // Stop the database if it's running
      if (instance.status === 'running') {
        if (spinner) spinner.text = `Stopping database '${name}'...`;
        await dockerManager.stopDatabase(name);
      }

      // Remove the database
      await dockerManager.removeDatabase(name, { keepData: options.keepData });
      await recordOperation({ operation: 'remove', source: name, success: true });

      spinner?.succeed(`Database '${name}' removed successfully`);

      if (jsonMode) {
        succeed('remove', { removed: true, name, dataKept: Boolean(options.keepData) }, jsonMode);
        return;
      }

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
        error: error instanceof Error ? error.message : String(error),
      });
      failFromError('remove', error, jsonMode);
    }
  });
