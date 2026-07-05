import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { HayaiDbManager } from '../../core/hayaidb.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

async function syncHandler(options: {
  config?: string;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
}): Promise<void> {
  const configPath = options.config || '.hayaidb';
  const jsonMode = Boolean(options.json);

  // Check if config file exists
  if (!(await HayaiDbManager.configExists(configPath))) {
    fail(
      'sync',
      ExitCode.NotFound,
      `Configuration file not found: ${configPath}`,
      jsonMode,
      'Generate one with: hayai export',
    );
  }

  const spinner = jsonMode ? null : ora('Loading configuration...').start();

  try {
    // Load and validate config
    const config = await HayaiDbManager.loadConfig(configPath);
    if (spinner) spinner.text = 'Validating configuration...';

    const databaseCount = Object.keys(config.databases).length;

    if (options.dryRun) {
      spinner?.succeed(`Configuration is valid (${databaseCount} databases)`);

      if (jsonMode) {
        succeed(
          'sync',
          {
            dryRun: true,
            project: config.project,
            version: config.version,
            databases: config.databases,
            profiles: config.profiles,
          },
          jsonMode,
        );
        return;
      }

      console.log(`\n📋 ${chalk.bold('Dry run - no databases will be created:')}`);
      console.log(`   ${chalk.cyan('Project:')} ${config.project || 'Unknown'}`);
      console.log(`   ${chalk.cyan('Version:')} ${config.version}`);

      console.log(`\n📊 ${chalk.bold('Databases to create:')}`);
      for (const [name, spec] of Object.entries(config.databases)) {
        const portInfo = spec.port ? ` (port ${spec.port})` : '';
        console.log(`   • ${chalk.green(name)} - ${spec.engine}${portInfo}`);
      }

      if (config.profiles) {
        console.log(`\n👥 ${chalk.bold('Available profiles:')}`);
        for (const [profile, databases] of Object.entries(config.profiles)) {
          console.log(`   • ${chalk.yellow(profile)}: ${databases.join(', ')}`);
        }
      }

      return;
    }

    // Sync databases
    if (spinner) spinner.text = 'Synchronizing databases...';
    const result = await HayaiDbManager.syncConfig(configPath);

    // Partial failure is a failure for the caller — some databases in the
    // declared state do not exist. The envelope still carries what happened.
    if (result.errors.length > 0) {
      spinner?.fail(`Synchronization finished with ${result.errors.length} error(s)`);
      if (!jsonMode) {
        for (const error of result.errors) {
          console.error(`   • ${chalk.red(error.name)}: ${error.error}`);
        }
      }
      fail('sync', ExitCode.Error, `${result.errors.length} database(s) failed to sync`, jsonMode);
    }

    spinner?.succeed('Database synchronization completed!');

    if (jsonMode) {
      succeed('sync', { created: result.created, skipped: result.skipped }, jsonMode);
      return;
    }

    // Show results
    console.log(`\n📊 ${chalk.bold('Synchronization Results:')}`);

    if (result.created.length > 0) {
      console.log(`\n✅ ${chalk.green('Created:')} ${result.created.length} databases`);
      for (const name of result.created) {
        console.log(`   • ${chalk.green(name)}`);
      }
    }

    if (result.skipped.length > 0) {
      console.log(
        `\n⏭️  ${chalk.yellow('Skipped:')} ${result.skipped.length} databases (already exist)`,
      );
      for (const name of result.skipped) {
        console.log(`   • ${chalk.yellow(name)}`);
      }
    }

    // Next steps
    if (result.created.length > 0) {
      console.log('\n💡 Next steps:');
      console.log(`   • Run ${chalk.cyan('hayai list')} to see all databases`);
      console.log(`   • Run ${chalk.cyan('hayai start')} to start the databases`);
      console.log(`   • Run ${chalk.cyan('hayai studio')} to access admin dashboards`);
    }
  } catch (error) {
    spinner?.fail('Failed to synchronize databases');
    if (options.verbose && !jsonMode) {
      console.error('\n📋 Details:', error);
    }
    failFromError('sync', error, jsonMode);
  }
}

export const syncCommand = new Command('sync')
  .description(
    'Synchronize databases from .hayaidb configuration file (additive: never modifies or removes existing instances)',
  )
  .option('-c, --config <path>', 'Configuration file path (default: .hayaidb)')
  .option('--dry-run', 'Show what would be created without making changes')
  .option('--verbose', 'Enable verbose output')
  .option('--json', 'Machine-readable JSON output on stdout')
  .action(syncHandler);
