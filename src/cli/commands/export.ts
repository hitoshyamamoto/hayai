import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { HayaiDbManager } from '../../core/hayaidb.js';

async function exportHandler(options: {
  output?: string;
  format?: string;
  verbose?: boolean;
}): Promise<void> {
  const spinner = ora('Exporting database configuration...').start();

  try {
    const outputPath = await HayaiDbManager.exportConfig(options.output);

    spinner.succeed(`Configuration exported to ${chalk.green(outputPath)}`);

    console.log('\n📄 Configuration file created!');
    console.log(`   ${chalk.cyan('File:')} ${outputPath}`);

    if (!options.output) {
      console.log('\n💡 Usage:');
      console.log('   • Edit the .hayaidb file to customize your setup');
      console.log('   • Share it with your team for consistent environments');
      console.log('   • Use `hayai sync` to recreate databases from this file');
    }
  } catch (error) {
    spinner.fail('Failed to export configuration');

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

export const exportCommand = new Command('export')
  .description('Export current database configuration to .hayaidb file')
  .option('-o, --output <path>', 'Output file path (default: .hayaidb)')
  .option('-f, --format <format>', 'Output format (yaml)', 'yaml')
  .option('--verbose', 'Enable verbose output')
  .action(exportHandler);
