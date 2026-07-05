import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { HayaiDbManager } from '../../core/hayaidb.js';
import { failFromError, succeed } from '../cli-output.js';

async function exportHandler(options: {
  output?: string;
  format?: string;
  verbose?: boolean;
  json?: boolean;
}): Promise<void> {
  const jsonMode = Boolean(options.json);
  const spinner = jsonMode ? null : ora('Exporting database configuration...').start();

  try {
    const outputPath = await HayaiDbManager.exportConfig(options.output);

    spinner?.succeed(`Configuration exported to ${chalk.green(outputPath)}`);

    if (jsonMode) {
      succeed('export', { file: outputPath }, jsonMode);
      return;
    }

    console.log('\n📄 Configuration file created!');
    console.log(`   ${chalk.cyan('File:')} ${outputPath}`);

    if (!options.output) {
      console.log('\n💡 Usage:');
      console.log('   • Edit the .hayaidb file to customize your setup');
      console.log('   • Share it with your team for consistent environments');
      console.log('   • Use `hayai sync` to recreate databases from this file');
    }
  } catch (error) {
    spinner?.fail('Failed to export configuration');
    if (options.verbose && !jsonMode) {
      console.error('\n📋 Details:', error);
    }
    failFromError('export', error, jsonMode);
  }
}

export const exportCommand = new Command('export')
  .description('Export current database configuration to .hayaidb file')
  .option('-o, --output <path>', 'Output file path (default: .hayaidb)')
  .option('-f, --format <format>', 'Output format (yaml)', 'yaml')
  .option('--verbose', 'Enable verbose output')
  .option('--json', 'Machine-readable JSON output on stdout')
  .action(exportHandler);
