import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { getDockerManager } from '../../core/docker.js';
import { getComposeFilePath } from '../../core/config.js';
import { LogOptions } from '../../core/types.js';

export const logsCommand = new Command('logs')
  .description('View logs from a database instance')
  .argument('<name>', 'Database instance name')
  .option('-f, --follow', 'Follow log output')
  .option('-t, --tail <lines>', 'Number of lines to show from the end of the logs', parseInt)
  .option('--since <timestamp>', 'Show logs since timestamp (e.g. 2013-01-02T13:23:37Z)')
  .action(async (name: string, options: LogOptions) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      const instance = dockerManager.getInstance(name);
      if (!instance) {
        console.error(chalk.red(`❌ Database instance '${name}' not found`));
        console.log(chalk.yellow('💡 Run `hayai list` to see available databases'));
        process.exit(1);
      }

      const composeFilePath = await getComposeFilePath();
      const args = ['compose', '-f', composeFilePath, 'logs'];

      if (options.follow) {
        args.push('--follow');
      }
      if (options.tail !== undefined) {
        args.push('--tail', String(options.tail));
      }
      if (options.since) {
        args.push('--since', options.since);
      }
      args.push(`${name}-db`);

      console.log(chalk.cyan(`📋 Logs for '${name}':`));
      if (options.follow) {
        console.log(chalk.gray('Following logs... (Press Ctrl+C to stop)'));
      }
      console.log(chalk.gray('─'.repeat(50)));

      const child = spawn('docker', args, { stdio: 'inherit' });

      child.on('error', (error) => {
        console.error(chalk.red('\n❌ Failed to show logs:'), error.message);
        process.exit(1);
      });

      child.on('close', (code) => {
        process.exit(code ?? 0);
      });
    } catch (error) {
      console.error(chalk.red('\n❌ Failed to show logs:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
