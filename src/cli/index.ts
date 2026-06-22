#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { listCommand } from './commands/list.js';
import { removeCommand } from './commands/remove.js';
import { logsCommand } from './commands/logs.js';
import { studioCommand } from './commands/studio.js';
import { snapshotCommand } from './commands/snapshot.js';
import { restoreCommand } from './commands/restore.js';
import { exportCommand } from './commands/export.js';
import { syncCommand } from './commands/sync.js';
import { cloneCommand } from './commands/clone.js';
import { mergeCommand } from './commands/merge.js';
import { migrateCommand } from './commands/migrate.js';
import { securityCommand } from './commands/security.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

const program = new Command();

// ASCII Art Banner
const banner = `
${chalk.cyan('⚡ Hayai')} ${chalk.gray(`v${version}`)}
${chalk.gray('Instantly create and manage local databases with one command')}
`;

// Enhanced help text with examples
const helpText = `
${banner}

${chalk.bold('USAGE')}
  ${chalk.cyan('hayai')} ${chalk.gray('[command] [options]')}

${chalk.bold('EXAMPLES')}
  ${chalk.gray('# Quick start - create a PostgreSQL database')}
  ${chalk.cyan('hayai init')}
  
  ${chalk.gray('# Create a specific database non-interactively')}
  ${chalk.cyan('hayai init -n myapp -e postgresql -y')}
  
  ${chalk.gray('# Start all databases')}
  ${chalk.cyan('hayai start')}
  
  ${chalk.gray('# Open admin dashboards')}
  ${chalk.cyan('hayai studio')}
  
  ${chalk.gray('# Create Redis cache for development')}
  ${chalk.cyan('hayai init -n cache -e redis -y')}
  
  ${chalk.gray('# Clone database for testing')}
  ${chalk.cyan('hayai clone --from prod --to staging')}
  
  ${chalk.gray('# Merge two databases')}
  ${chalk.cyan('hayai merge --source dbA --target dbB --preview')}
  
  ${chalk.gray('# Migrate between compatible engines')}
  ${chalk.cyan('hayai migrate --from influx2-db --to influx3-db --target-engine influxdb3')}
  
  ${chalk.gray('# Configure security settings')}
  ${chalk.cyan('hayai security --init')}
  
  ${chalk.gray('# Export current databases to .hayaidb file')}
  ${chalk.cyan('hayai export')}
  
  ${chalk.gray('# Recreate databases from .hayaidb file')}
  ${chalk.cyan('hayai sync')}

${chalk.bold('SUPPORTED DATABASES')}
  ${chalk.green('SQL:')}           postgresql, mariadb
  ${chalk.green('Analytics:')}     duckdb
  ${chalk.green('Embedded:')}      sqlite, lmdb
  ${chalk.green('Key-Value:')}     redis, leveldb, tikv
  ${chalk.green('Wide Column:')}   cassandra
  ${chalk.green('Vector:')}        qdrant, weaviate, milvus
  ${chalk.green('Graph:')}         arangodb, nebula
  ${chalk.green('Search:')}        meilisearch, typesense
  ${chalk.green('Time Series:')}   influxdb2, influxdb3, timescaledb, questdb, victoriametrics, horaedb

${chalk.bold('LEARN MORE')}
  Documentation:  ${chalk.cyan('https://github.com/hitoshyamamoto/hayai#readme')}
  Report issues:  ${chalk.cyan('https://github.com/hitoshyamamoto/hayai/issues')}

${chalk.bold('OPTIONS')}`;

// Configure the main program
program
  .name('hayai')
  .description('Fast, modern CLI tool for managing local databases')
  .version(version, '-v, --version', 'output the current version')
  .option('--verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress output except errors')
  .configureHelp({
    formatHelp: () => {
      return (
        helpText +
        `

${chalk.bold('COMMANDS')}
  ${chalk.cyan('init')}          Initialize a new database instance
  ${chalk.cyan('start')} [name]  Start database instances
  ${chalk.cyan('stop')} [name]   Stop database instances
  ${chalk.cyan('list')}          List all database instances
  ${chalk.cyan('remove')} <name> Remove a database instance
  ${chalk.cyan('logs')} <name>   View logs from a database instance
  ${chalk.cyan('studio')} [name] Open admin dashboards
  ${chalk.cyan('snapshot')} <name> Create a database snapshot
  ${chalk.cyan('restore')} <snapshot> Restore a database from a snapshot
  ${chalk.cyan('clone')} <options> Clone database instances (compatible engines only)
  ${chalk.cyan('merge')} <options> Merge two database instances
  ${chalk.cyan('migrate')} <options> Migrate between compatible engines
  ${chalk.cyan('security')} <options> Configure and manage security settings
  ${chalk.cyan('export')}         Export current databases to .hayaidb file
  ${chalk.cyan('sync')}           Sync databases from .hayaidb configuration

${chalk.gray('Run')} ${chalk.cyan('hayai <command> --help')} ${chalk.gray('for detailed information on a command.')}

${chalk.bold('OPTIONS')}
  ${chalk.cyan('-v, --version')}       Output the current version
  ${chalk.cyan('--verbose')}          Enable verbose logging
  ${chalk.cyan('-q, --quiet')}        Suppress output except errors
  ${chalk.cyan('-h, --help')}         Display help for command
`
      );
    },
  })
  .hook('preAction', async () => {
    if (!program.opts().quiet) {
      console.log(banner);
    }
  });

// Register commands
program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(startCommand);
program.addCommand(stopCommand);
program.addCommand(removeCommand);
program.addCommand(logsCommand);
program.addCommand(studioCommand);
program.addCommand(snapshotCommand);
program.addCommand(restoreCommand);
program.addCommand(cloneCommand);
program.addCommand(mergeCommand);
program.addCommand(migrateCommand);
program.addCommand(exportCommand);
program.addCommand(syncCommand);
program.addCommand(securityCommand);

// Handle unknown commands
program.on('command:*', (operands) => {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log(chalk.yellow('💡 Run `hayai --help` for available commands'));
  console.log(
    chalk.cyan('📚 See https://github.com/hitoshyamamoto/hayai#readme for documentation'),
  );
  process.exit(1);
});

// Custom help for no arguments
if (process.argv.length === 2) {
  console.log(helpText);
  console.log(`
${chalk.bold('COMMANDS')}
  ${chalk.cyan('init')}          Initialize a new database instance
  ${chalk.cyan('start')} [name]  Start database instances
  ${chalk.cyan('stop')} [name]   Stop database instances
  ${chalk.cyan('list')}          List all database instances
  ${chalk.cyan('remove')} <name> Remove a database instance
  ${chalk.cyan('logs')} <name>   View logs from a database instance
  ${chalk.cyan('studio')} [name] Open admin dashboards
  ${chalk.cyan('snapshot')} <name> Create a database snapshot
  ${chalk.cyan('restore')} <snapshot> Restore a database from a snapshot
  ${chalk.cyan('clone')} <options> Clone database instances (compatible engines only)
  ${chalk.cyan('merge')} <options> Merge two database instances
  ${chalk.cyan('migrate')} <options> Migrate between compatible engines
  ${chalk.cyan('security')} <options> Configure and manage security settings
  ${chalk.cyan('export')}         Export current databases to .hayaidb file
  ${chalk.cyan('sync')}           Sync databases from .hayaidb configuration

${chalk.gray('Run')} ${chalk.cyan('hayai <command> --help')} ${chalk.gray('for detailed information on a command.')}
`);
  process.exit(0);
}

// Parse command line arguments
program.parse();

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ Uncaught Exception:'), error.message);
  if (program.opts().verbose) {
    console.error(error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  if (program.opts().verbose) {
    console.error(reason);
  }
  process.exit(1);
});

export default program;
