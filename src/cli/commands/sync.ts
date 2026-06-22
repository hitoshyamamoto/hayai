import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { HayaiDbManager } from '../../core/hayaidb.js';

async function syncHandler(options: {
  config?: string;
  force?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}): Promise<void> {
  const configPath = options.config || '.hayaidb';

  // Check if config file exists
  if (!(await HayaiDbManager.configExists(configPath))) {
    console.error(`❌ ${chalk.red('Configuration file not found:')} ${configPath}`);
    console.log('\n💡 Generate one with:');
    console.log(`   ${chalk.cyan('hayai export')}`);
    process.exit(1);
  }

  const spinner = ora('Loading configuration...').start();

  try {
    // Load and validate config
    const config = await HayaiDbManager.loadConfig(configPath);
    spinner.text = 'Validating configuration...';

    const databaseCount = Object.keys(config.databases).length;

    if (options.dryRun) {
      spinner.succeed(`Configuration is valid (${databaseCount} databases)`);

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
    spinner.text = 'Synchronizing databases...';
    const result = await HayaiDbManager.syncConfig(configPath);

    spinner.succeed('Database synchronization completed!');

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

    if (result.errors.length > 0) {
      console.log(`\n❌ ${chalk.red('Errors:')} ${result.errors.length} databases failed`);
      for (const error of result.errors) {
        console.log(`   • ${chalk.red(error.name)}: ${error.error}`);
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
    spinner.fail('Failed to synchronize databases');

    if (error instanceof Error) {
      console.error(`\n❌ ${chalk.red('Error:')} ${error.message}`);
    } else {
      console.error(`\n❌ ${chalk.red('Unexpected error occurred')}`);
    }

    if (options.verbose) {
      console.error('\n📋 Details:', error);
    }

    process.exit(1);
  }
}

export const syncCommand = new Command('sync')
  .description('Synchronize databases from .hayaidb configuration file')
  .option('-c, --config <path>', 'Configuration file path (default: .hayaidb)')
  .option('--dry-run', 'Show what would be created without making changes')
  .option('--force', 'Force creation even if databases exist')
  .option('--verbose', 'Enable verbose output')
  .action(syncHandler);
