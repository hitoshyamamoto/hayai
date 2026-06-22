import { Command } from 'commander';
import chalk from 'chalk';
import { getDockerManager } from '../../core/docker.js';
import { buildConnectionInfo } from '../../core/connection.js';

export const connectCommand = new Command('connect')
  .description('Print connection details for a database instance')
  .argument('<name>', 'Database instance name')
  .option('--uri', 'Print only the connection URI (for scripts)')
  .option('--json', 'Print connection details as JSON')
  .addHelpText(
    'after',
    `
${chalk.bold('Examples:')}
  ${chalk.cyan('# Human-readable details')}
  hayai connect mydb

  ${chalk.cyan('# Just the URI — the banner goes to stderr, so this pipes cleanly')}
  export DATABASE_URL=$(hayai connect mydb --uri)

  ${chalk.cyan('# Structured output')}
  hayai connect mydb --json
`,
  )
  .action(async (name: string, options: { uri?: boolean; json?: boolean }) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      const instance = dockerManager.getInstance(name);
      if (!instance) {
        console.error(chalk.red(`❌ Database instance '${name}' not found`));
        console.log(chalk.yellow('💡 Run `hayai list` to see available databases'));
        process.exit(1);
      }

      const info = buildConnectionInfo(instance);

      if (options.uri) {
        console.log(info.uri);
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(info, null, 2));
        return;
      }

      console.log(chalk.bold(`\n🔌 ${info.name}`));
      console.log(`  Engine: ${chalk.cyan(info.engine)}`);
      console.log(`  Status: ${info.status}`);
      console.log(`  Host:   ${chalk.cyan(info.host)}`);
      console.log(`  Port:   ${info.port ? chalk.cyan(info.port) : chalk.gray('— (embedded)')}`);
      console.log(`  URI:    ${chalk.cyan(info.uri)}`);
      console.log(
        chalk.gray('\n💡 Script-friendly: ') + chalk.cyan(`hayai connect ${info.name} --uri`),
      );
    } catch (error) {
      console.error(
        chalk.red('\n❌ Failed to read connection details:'),
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
  });
