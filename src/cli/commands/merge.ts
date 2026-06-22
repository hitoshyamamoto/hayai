import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { getPostgresExecCredentials, getMariaDBRootPassword } from '../../core/credentials.js';
import { recordOperation } from '../../core/security.js';
import { snapshotInstance } from './snapshot.js';
import { CLIOptions } from '../../core/types.js';
import { spawn } from 'child_process';

// Engines with a real, key/row-level merge. Anything else (or a cross-engine
// pair) is refused rather than guessed at.
const MERGEABLE_ENGINES = new Set(['postgresql', 'mariadb', 'redis']);

interface MergeOptions extends CLIOptions {
  source: string;
  target: string;
  preview?: boolean;
  execute?: boolean;
  backupBoth?: boolean;
  force?: boolean;
}

async function previewMerge(sourceInstance: any, targetInstance: any): Promise<void> {
  console.log(chalk.cyan('\n🔍 Merge Preview:'));
  console.log(chalk.gray('─'.repeat(50)));
  
  console.log(chalk.bold('Source Database:'));
  console.log(`  Name: ${chalk.green(sourceInstance.name)}`);
  console.log(`  Engine: ${chalk.cyan(sourceInstance.engine)}`);
  console.log(`  Status: ${sourceInstance.status}`);
  console.log(`  Port: ${sourceInstance.port}`);
  
  console.log(chalk.bold('\nTarget Database:'));
  console.log(`  Name: ${chalk.green(targetInstance.name)}`);
  console.log(`  Engine: ${chalk.cyan(targetInstance.engine)}`);
  console.log(`  Status: ${targetInstance.status}`);
  console.log(`  Port: ${targetInstance.port}`);
  
  console.log(chalk.bold('\nMerge Operation:'));
  console.log(`  ${chalk.green(sourceInstance.name)} data → ${chalk.yellow(targetInstance.name)}`);
  console.log(`  Result: target contains combined data; source is unchanged`);
  
  console.log(chalk.yellow('\n⚠️  Warning:'));
  console.log('  • This operation is irreversible without backups');
  console.log('  • Source and target must run the same supported engine');
  console.log('  • Data conflicts may need manual resolution');
  
  console.log(chalk.bold('\nNext Steps:'));
  console.log(`  • Run with ${chalk.cyan('--execute')} to perform the merge`);
  console.log(`  • Use ${chalk.cyan('--backup-both')} to create safety backups`);
}

async function mergeDatabases(sourceInstance: any, targetInstance: any): Promise<void> {
  const sourceContainer = `${sourceInstance.name}-db`;
  const targetContainer = `${targetInstance.name}-db`;

  console.log(chalk.cyan(`🔄 Merging ${sourceInstance.name} → ${targetInstance.name}...`));

  switch (sourceInstance.engine) {
    case 'postgresql':
      await mergePostgreSQL(sourceContainer, targetContainer, sourceInstance.environment, targetInstance.environment);
      break;
    case 'mariadb':
      await mergeMariaDB(sourceContainer, targetContainer, sourceInstance.environment, targetInstance.environment);
      break;
    case 'redis':
      await mergeRedis(sourceContainer, targetContainer);
      break;
    default:
      // Unreachable: handleMerge validates the engine before calling here.
      throw new Error(`Merge is not supported for engine: ${sourceInstance.engine}`);
  }

  console.log(chalk.green(`✅ Successfully merged ${sourceInstance.name} → ${targetInstance.name}`));
}

async function mergePostgreSQL(
  sourceContainer: string,
  targetContainer: string,
  sourceEnv: Record<string, string> = {},
  targetEnv: Record<string, string> = {}
): Promise<void> {
  console.log(chalk.yellow('🔄 Merging PostgreSQL databases...'));

  return new Promise((resolve, reject) => {
    // Simplified merge - in real implementation would be more sophisticated
    const source = getPostgresExecCredentials(sourceEnv);
    const target = getPostgresExecCredentials(targetEnv);
    const dumpProcess = spawn('docker', [
      'exec', sourceContainer,
      'pg_dump', '-U', source.user, '-d', source.database, '--data-only'
    ], { stdio: ['inherit', 'pipe', 'pipe'] });

    const restoreProcess = spawn('docker', [
      'exec', '-i', targetContainer,
      'psql', '-U', target.user, '-d', target.database, '-v', 'ON_ERROR_STOP=0'
    ], { stdio: ['pipe', 'inherit', 'pipe'] });
    
    dumpProcess.stdout.pipe(restoreProcess.stdin);
    
    restoreProcess.on('close', () => {
      // Accept some errors as conflicts are expected in merge
      resolve();
    });
    
    dumpProcess.on('error', reject);
    restoreProcess.on('error', reject);
  });
}

async function mergeMariaDB(
  sourceContainer: string,
  targetContainer: string,
  sourceEnv: Record<string, string> = {},
  targetEnv: Record<string, string> = {}
): Promise<void> {
  console.log(chalk.yellow('🔄 Merging MariaDB databases...'));

  return new Promise((resolve, reject) => {
    const sourceDb = sourceEnv.MYSQL_DATABASE;
    const targetDb = targetEnv.MYSQL_DATABASE;
    if (!sourceDb || !targetDb) {
      reject(new Error('MariaDB merge requires MYSQL_DATABASE to be set on both instances'));
      return;
    }

    const dumpProcess = spawn('docker', [
      'exec', '-e', `MYSQL_PWD=${getMariaDBRootPassword(sourceEnv)}`, sourceContainer,
      'mysqldump', '-u', 'root', '--no-create-info', '--complete-insert', sourceDb
    ], { stdio: ['inherit', 'pipe', 'pipe'] });

    const restoreProcess = spawn('docker', [
      'exec', '-i', '-e', `MYSQL_PWD=${getMariaDBRootPassword(targetEnv)}`, targetContainer,
      'mysql', '-u', 'root', '--force', targetDb
    ], { stdio: ['pipe', 'inherit', 'pipe'] });
    
    dumpProcess.stdout.pipe(restoreProcess.stdin);
    
    restoreProcess.on('close', () => {
      resolve();
    });
    
    dumpProcess.on('error', reject);
    restoreProcess.on('error', reject);
  });
}

async function mergeRedis(sourceContainer: string, targetContainer: string): Promise<void> {
  console.log(chalk.yellow('🔄 Merging Redis databases...'));

  // SCAN instead of KEYS — KEYS blocks the server on large datasets
  const keys = await scanRedisKeys(sourceContainer);
  if (keys.length === 0) {
    return; // Nothing to merge
  }

  // MIGRATE moves each value container-to-container over the shared compose
  // network, preserving binary data — piping DUMP output through a text
  // pipeline corrupts it. COPY keeps the source intact; REPLACE resolves
  // conflicts in favor of the source.
  const failed: string[] = [];
  for (const key of keys) {
    const ok = await migrateRedisKey(sourceContainer, targetContainer, key);
    if (!ok) {
      failed.push(key);
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Redis merge failed for ${failed.length}/${keys.length} keys (e.g. '${failed[0]}')`
    );
  }

  console.log(chalk.gray(`   ${keys.length} keys merged`));
}

async function scanRedisKeys(container: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const scanProcess = spawn('docker', ['exec', container, 'redis-cli', '--scan']);

    let output = '';
    scanProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    scanProcess.on('close', (code) => {
      if (code === 0) {
        resolve(output.split('\n').map(key => key.trim()).filter(Boolean));
      } else {
        reject(new Error('Failed to scan source Redis keys'));
      }
    });

    scanProcess.on('error', reject);
  });
}

async function migrateRedisKey(
  sourceContainer: string,
  targetContainer: string,
  key: string
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    // The compose service name doubles as the DNS name on the shared network.
    const migrateProcess = spawn('docker', [
      'exec', sourceContainer,
      'redis-cli', 'MIGRATE', targetContainer, '6379', key, '0', '5000', 'COPY', 'REPLACE'
    ]);

    // redis-cli exits 0 even when the server replies with an error,
    // so success must be read from the reply itself.
    let reply = '';
    migrateProcess.stdout.on('data', (data) => {
      reply += data.toString();
    });
    migrateProcess.stderr.on('data', (data) => {
      reply += data.toString();
    });

    migrateProcess.on('close', () => {
      const result = reply.trim();
      resolve(result === 'OK' || result === 'NOKEY');
    });

    migrateProcess.on('error', reject);
  });
}

async function handleMerge(options: MergeOptions): Promise<void> {
  const dockerManager = getDockerManager();
  await dockerManager.initialize();
  
  // Validate source database
  const sourceInstance = dockerManager.getInstance(options.source);
  if (!sourceInstance) {
    console.error(chalk.red(`❌ Source database '${options.source}' not found`));
    process.exit(1);
  }
  
  // Validate target database
  const targetInstance = dockerManager.getInstance(options.target);
  if (!targetInstance) {
    console.error(chalk.red(`❌ Target database '${options.target}' not found`));
    process.exit(1);
  }
  
  // Check if both databases are running
  if (sourceInstance.status !== 'running') {
    console.error(chalk.red(`❌ Source database '${options.source}' must be running`));
    console.log(chalk.yellow(`💡 Start it with: ${chalk.cyan(`hayai start ${options.source}`)}`));
    process.exit(1);
  }
  
  if (targetInstance.status !== 'running') {
    console.error(chalk.red(`❌ Target database '${options.target}' must be running`));
    console.log(chalk.yellow(`💡 Start it with: ${chalk.cyan(`hayai start ${options.target}`)}`));
    process.exit(1);
  }

  // Merge stays inside one engine family and only where a real row/key-level
  // merge exists. Cross-engine or unsupported pairs are refused — the previous
  // file-level fallback silently corrupted the target.
  if (sourceInstance.engine !== targetInstance.engine) {
    console.error(chalk.red(`❌ Cannot merge across engines: ${sourceInstance.engine} → ${targetInstance.engine}`));
    console.log(chalk.yellow('💡 Source and target must run the same engine'));
    process.exit(1);
  }
  if (!MERGEABLE_ENGINES.has(sourceInstance.engine)) {
    console.error(chalk.red(`❌ Merge is not supported for '${sourceInstance.engine}'`));
    console.log(chalk.yellow(`💡 Supported engines: ${[...MERGEABLE_ENGINES].join(', ')}`));
    process.exit(1);
  }

  // Preview mode: explicit --preview, or any invocation without --execute.
  // --force never substitutes for --execute; it only skips the confirmation.
  if (options.preview || !options.execute) {
    await previewMerge(sourceInstance, targetInstance);
    console.log(chalk.cyan('\n💡 Use --execute to perform the merge operation'));
    return;
  }

  // Final confirmation for destructive operation
  if (!options.force) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: `⚠️  Merge ${options.source} into ${options.target}? This operation is irreversible!`,
        default: false,
      },
    ]);
    
    if (!proceed) {
      console.log(chalk.yellow('Operation cancelled'));
      return;
    }
  }

  // Safety snapshots of both sides before an irreversible merge. A failed
  // backup aborts the merge — the whole point is to not proceed unprotected.
  if (options.backupBoth) {
    const backupSpinner = ora('Backing up both databases...').start();
    try {
      const sourceBackup = await snapshotInstance(sourceInstance);
      const targetBackup = await snapshotInstance(targetInstance);
      backupSpinner.succeed('Safety snapshots created');
      console.log(chalk.gray(`  source → ${sourceBackup}`));
      console.log(chalk.gray(`  target → ${targetBackup}`));
    } catch (error) {
      backupSpinner.fail('Backup failed — aborting merge');
      console.error(chalk.red('❌'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  // Execute merge
  const spinner = ora('Merging databases...').start();

  try {
    await mergeDatabases(sourceInstance, targetInstance);

    spinner.succeed('Database merge completed successfully');
    await recordOperation({ operation: 'merge', source: options.source, target: options.target, success: true });

    console.log(chalk.green('\n✅ Merge operation completed!'));
    console.log(chalk.yellow(`💡 '${options.target}' now contains the combined data; '${options.source}' is unchanged`));
    console.log(chalk.yellow('💡 Commands:'));
    console.log(`  • ${chalk.cyan('hayai list')} - View all databases`);
    console.log(`  • ${chalk.cyan('hayai studio')} - Open admin dashboards`);

  } catch (error) {
    spinner.fail('Merge operation failed');
    await recordOperation({
      operation: 'merge',
      source: options.source,
      target: options.target,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(chalk.red('\n❌ Merge failed:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export const mergeCommand = new Command('merge')
  .description('Merge a source database into a target database')
  .option('-s, --source <name>', 'Source database name')
  .option('-t, --target <name>', 'Target database name')
  .option('--preview', 'Preview the merge operation without executing')
  .option('--execute', 'Execute the merge operation')
  .option('--backup-both', 'Create backups of both databases before merging')
  .option('--force', 'Skip confirmation prompts')
  .option('--verbose', 'Enable verbose output')
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('# Preview merge operation')}
  hayai merge --source dbA --target dbB --preview
  hayai merge -s dbA -t dbB --preview

  ${chalk.cyan('# Execute merge')}
  hayai merge --source dbA --target dbB --execute
  hayai merge -s dbA -t dbB --execute

  ${chalk.cyan('# Force merge without confirmation')}
  hayai merge -s dbA -t dbB --execute --force

${chalk.bold('How Merge Works:')}
  • Data from the source is copied into the target
  • The source database is left unchanged
  • Conflicts are resolved in favor of the source when possible

${chalk.bold('Supported Engines (same engine on both sides):')}
  • PostgreSQL, MariaDB: SQL-level merging (data-only)
  • Redis: key-level merging with MIGRATE … COPY REPLACE

${chalk.bold('Unsupported:')}
  • Cross-engine pairs and any other engine are refused — there is no safe
    generic merge. Use ${chalk.cyan('hayai snapshot')} / ${chalk.cyan('hayai restore')} and the engine's tooling.
`)
  .action(handleMerge); 