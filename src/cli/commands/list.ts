import { Command } from 'commander';
import chalk from 'chalk';
import { getDockerManager } from '../../core/docker.js';
import { getTemplate } from '../../core/templates.js';
import { failFromError, succeed } from '../cli-output.js';

export const listCommand = new Command('list')
  .description('List all database instances')
  .option('-r, --running', 'Show only running instances')
  .option('-s, --stopped', 'Show only stopped instances')
  .option('--format <format>', 'Output format (table, json)', 'table')
  .option('--json', 'Machine-readable JSON envelope on stdout (see AUTOMATION.md)')
  .action(async (options) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      let instances = dockerManager.getAllInstances();

      if (options.running) {
        instances = dockerManager.getRunningInstances();
      } else if (options.stopped) {
        instances = dockerManager.getStoppedInstances();
      }

      // Envelope form of the contract; --format json stays as the raw-array
      // shape it has always emitted.
      if (options.json) {
        succeed('list', { instances }, true);
        return;
      }

      if (instances.length === 0) {
        console.log(chalk.yellow('📦 No database instances found'));
        console.log(chalk.gray('💡 Run `hayai init` to create your first database'));
        return;
      }

      if (options.format === 'json') {
        console.log(JSON.stringify(instances, null, 2));
        return;
      }

      // Table format
      console.log(chalk.bold('\n📊 Database Instances:\n'));

      const statusIcon = (status: string) => {
        switch (status) {
          case 'running':
            return chalk.green('●');
          case 'stopped':
            return chalk.red('●');
          case 'embedded':
            return chalk.cyan('●');
          case 'error':
            return chalk.red('⚠');
          default:
            return chalk.gray('○');
        }
      };

      const statusColor = (status: string) =>
        status === 'running'
          ? chalk.green(status)
          : status === 'embedded'
            ? chalk.cyan('embedded (file-based)')
            : chalk.red(status);

      instances.forEach((instance, index) => {
        const template = getTemplate(instance.engine);
        const engineName = template?.name || instance.engine;

        console.log(`${index + 1}. ${chalk.bold(instance.name)} ${statusIcon(instance.status)}`);
        console.log(`   Engine: ${chalk.cyan(engineName)}`);
        console.log(`   Status: ${statusColor(instance.status)}`);
        console.log(`   Port: ${instance.port > 0 ? chalk.cyan(instance.port) : chalk.gray('—')}`);
        console.log(`   URI: ${chalk.gray(instance.connection_uri)}`);
        console.log(
          `   Created: ${chalk.gray(new Date(instance.created_at).toLocaleDateString())}`,
        );
        console.log('');
      });

      const running = instances.filter((i) => i.status === 'running').length;
      const stopped = instances.filter((i) => i.status === 'stopped').length;
      const embedded = instances.filter((i) => i.status === 'embedded').length;
      const error = instances.filter((i) => i.status === 'error').length;

      console.log(chalk.bold('Summary:'));
      console.log(`  Total: ${chalk.cyan(instances.length)}`);
      console.log(`  Running: ${chalk.green(running)}`);
      console.log(`  Stopped: ${chalk.red(stopped)}`);
      if (embedded > 0) {
        console.log(`  Embedded: ${chalk.cyan(embedded)}`);
      }
      if (error > 0) {
        console.log(`  Error: ${chalk.red(error)}`);
      }

      console.log(chalk.yellow('\n💡 Commands:'));
      console.log('  • hayai start <name>  - Start a database');
      console.log('  • hayai stop <name>   - Stop a database');
      console.log('  • hayai remove <name> - Remove a database');
      console.log('  • hayai studio        - Open admin dashboards');
    } catch (error) {
      failFromError('list', error, Boolean(options.json));
    }
  });
