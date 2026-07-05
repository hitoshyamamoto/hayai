import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { composeServiceName, resolveServiceContainer } from '../../core/containers.js';
import { getPostgresExecCredentials, getMariaDBRootPassword } from '../../core/credentials.js';
import { recordOperation } from '../../core/security.js';
import { snapshotInstance } from './snapshot.js';
import { CLIOptions } from '../../core/types.js';
import { spawn } from 'child_process';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

// Engines with a real, key/row-level merge. Anything else (or a cross-engine
// pair) is refused rather than guessed at.
const MERGEABLE_ENGINES = new Set(['postgresql', 'mariadb', 'mysql', 'redis', 'valkey']);

interface MergeOptions extends CLIOptions {
  source: string;
  target: string;
  preview?: boolean;
  execute?: boolean;
  backupBoth?: boolean;
  force?: boolean;
  json?: boolean;
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
  console.log(
    '  • On key conflicts: PostgreSQL/MariaDB keep the target row; Redis takes the source value',
  );

  console.log(chalk.bold('\nNext Steps:'));
  console.log(`  • Run with ${chalk.cyan('--execute')} to perform the merge`);
  console.log(`  • Use ${chalk.cyan('--backup-both')} to create safety backups`);
}

async function mergeDatabases(sourceInstance: any, targetInstance: any): Promise<void> {
  // Compose names containers '<project>-<service>-<n>'; resolve the real ones
  // before any docker exec. Network DNS is a different namespace: there the
  // plain service name still applies (see mergeRedis).
  const sourceContainer = await resolveServiceContainer(sourceInstance.name);
  const targetContainer = await resolveServiceContainer(targetInstance.name);

  console.log(chalk.cyan(`🔄 Merging ${sourceInstance.name} → ${targetInstance.name}...`));

  switch (sourceInstance.engine) {
    case 'postgresql':
      await mergePostgreSQL(
        sourceContainer,
        targetContainer,
        sourceInstance.environment,
        targetInstance.environment,
      );
      break;
    case 'mariadb':
      await mergeMariaDB(
        sourceContainer,
        targetContainer,
        sourceInstance.environment,
        targetInstance.environment,
        { dump: 'mariadb-dump', client: 'mariadb' },
      );
      break;
    case 'mysql':
      await mergeMariaDB(
        sourceContainer,
        targetContainer,
        sourceInstance.environment,
        targetInstance.environment,
        { dump: 'mysqldump', client: 'mysql' },
      );
      break;
    case 'redis':
      await mergeRedis(sourceContainer, composeServiceName(targetInstance.name), 'redis-cli');
      break;
    case 'valkey':
      await mergeRedis(sourceContainer, composeServiceName(targetInstance.name), 'valkey-cli');
      break;
    default:
      // Unreachable: handleMerge validates the engine before calling here.
      throw new Error(`Merge is not supported for engine: ${sourceInstance.engine}`);
  }

  console.log(
    chalk.green(`✅ Successfully merged ${sourceInstance.name} → ${targetInstance.name}`),
  );
}

async function mergePostgreSQL(
  sourceContainer: string,
  targetContainer: string,
  sourceEnv: Record<string, string> = {},
  targetEnv: Record<string, string> = {},
): Promise<void> {
  console.log(chalk.yellow('🔄 Merging PostgreSQL databases...'));

  return new Promise((resolve, reject) => {
    const source = getPostgresExecCredentials(sourceEnv);
    const target = getPostgresExecCredentials(targetEnv);
    // --inserts is load-bearing: the default COPY format is all-or-nothing per
    // table, so one key collision with existing target rows would discard the
    // whole table's data. Row-per-INSERT lets conflicting rows fail
    // individually (target wins) while everything else merges.
    const dumpProcess = spawn(
      'docker',
      [
        'exec',
        sourceContainer,
        'pg_dump',
        '-U',
        source.user,
        '-d',
        source.database,
        '--data-only',
        '--inserts',
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const restoreProcess = spawn(
      'docker',
      [
        'exec',
        '-i',
        targetContainer,
        'psql',
        '-U',
        target.user,
        '-d',
        target.database,
        '-v',
        'ON_ERROR_STOP=0',
      ],
      { stdio: ['pipe', 'inherit', 'pipe'] },
    );

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
  targetEnv: Record<string, string> = {},
  binaries: { dump: string; client: string } = { dump: 'mariadb-dump', client: 'mariadb' },
): Promise<void> {
  console.log(chalk.yellow('🔄 Merging MariaDB databases...'));

  return new Promise((resolve, reject) => {
    const sourceDb = sourceEnv.MYSQL_DATABASE;
    const targetDb = targetEnv.MYSQL_DATABASE;
    if (!sourceDb || !targetDb) {
      reject(new Error('MariaDB merge requires MYSQL_DATABASE to be set on both instances'));
      return;
    }

    const dumpProcess = spawn(
      'docker',
      [
        'exec',
        '-e',
        `MYSQL_PWD=${getMariaDBRootPassword(sourceEnv)}`,
        sourceContainer,
        binaries.dump,
        '-u',
        'root',
        '--no-create-info',
        '--complete-insert',
        sourceDb,
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const restoreProcess = spawn(
      'docker',
      [
        'exec',
        '-i',
        '-e',
        `MYSQL_PWD=${getMariaDBRootPassword(targetEnv)}`,
        targetContainer,
        binaries.client,
        '-u',
        'root',
        '--force',
        targetDb,
      ],
      { stdio: ['pipe', 'inherit', 'pipe'] },
    );

    dumpProcess.stdout.pipe(restoreProcess.stdin);

    restoreProcess.on('close', () => {
      resolve();
    });

    dumpProcess.on('error', reject);
    restoreProcess.on('error', reject);
  });
}

async function mergeRedis(
  sourceContainer: string,
  targetServiceHost: string,
  cli: string = 'redis-cli',
): Promise<void> {
  console.log(chalk.yellow('🔄 Merging Redis databases...'));

  // SCAN instead of KEYS — KEYS blocks the server on large datasets
  const keys = await scanRedisKeys(sourceContainer, cli);
  if (keys.length === 0) {
    return; // Nothing to merge
  }

  // MIGRATE moves each value container-to-container over the shared compose
  // network, preserving binary data — piping DUMP output through a text
  // pipeline corrupts it. COPY keeps the source intact; REPLACE resolves
  // conflicts in favor of the source. The target is addressed by its compose
  // service name, which doubles as its DNS name on the shared network.
  const failed: string[] = [];
  for (const key of keys) {
    const ok = await migrateRedisKey(sourceContainer, targetServiceHost, key, cli);
    if (!ok) {
      failed.push(key);
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `Redis merge failed for ${failed.length}/${keys.length} keys (e.g. '${failed[0]}')`,
    );
  }

  console.log(chalk.gray(`   ${keys.length} keys merged`));
}

async function scanRedisKeys(container: string, cli: string = 'redis-cli'): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const scanProcess = spawn('docker', ['exec', container, cli, '--scan']);

    let output = '';
    scanProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    scanProcess.on('close', (code) => {
      if (code === 0) {
        resolve(
          output
            .split('\n')
            .map((key) => key.trim())
            .filter(Boolean),
        );
      } else {
        reject(new Error('Failed to scan source Redis keys'));
      }
    });

    scanProcess.on('error', reject);
  });
}

async function migrateRedisKey(
  sourceContainer: string,
  targetServiceHost: string,
  key: string,
  cli: string = 'redis-cli',
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const migrateProcess = spawn('docker', [
      'exec',
      sourceContainer,
      cli,
      'MIGRATE',
      targetServiceHost,
      '6379',
      key,
      '0',
      '5000',
      'COPY',
      'REPLACE',
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
  const jsonMode = Boolean(options.json);
  const dockerManager = getDockerManager();
  await dockerManager.initialize();

  // Validate source database
  const sourceInstance = dockerManager.getInstance(options.source);
  if (!sourceInstance) {
    fail('merge', ExitCode.NotFound, `Source database '${options.source}' not found`, jsonMode);
  }

  // Validate target database
  const targetInstance = dockerManager.getInstance(options.target);
  if (!targetInstance) {
    fail('merge', ExitCode.NotFound, `Target database '${options.target}' not found`, jsonMode);
  }

  // Check if both databases are running
  if (sourceInstance.status !== 'running') {
    fail(
      'merge',
      ExitCode.Precondition,
      `Source database '${options.source}' must be running`,
      jsonMode,
      `Start it with: hayai start ${options.source}`,
    );
  }

  if (targetInstance.status !== 'running') {
    fail(
      'merge',
      ExitCode.Precondition,
      `Target database '${options.target}' must be running`,
      jsonMode,
      `Start it with: hayai start ${options.target}`,
    );
  }

  // Merge stays inside one engine family and only where a real row/key-level
  // merge exists. Cross-engine or unsupported pairs are refused — the previous
  // file-level fallback silently corrupted the target.
  if (sourceInstance.engine !== targetInstance.engine) {
    fail(
      'merge',
      ExitCode.Precondition,
      `Cannot merge across engines: ${sourceInstance.engine} → ${targetInstance.engine}`,
      jsonMode,
      'Source and target must run the same engine',
    );
  }
  if (!MERGEABLE_ENGINES.has(sourceInstance.engine)) {
    fail(
      'merge',
      ExitCode.Precondition,
      `Merge is not supported for '${sourceInstance.engine}'`,
      jsonMode,
      `Supported engines: ${[...MERGEABLE_ENGINES].join(', ')}`,
    );
  }

  // Preview mode: explicit --preview, or any invocation without --execute.
  // --force never substitutes for --execute; it only skips the confirmation.
  if (options.preview || !options.execute) {
    if (jsonMode) {
      succeed(
        'merge',
        {
          executed: false,
          preview: true,
          source: options.source,
          target: options.target,
          engine: sourceInstance.engine,
        },
        jsonMode,
      );
      return;
    }
    await previewMerge(sourceInstance, targetInstance);
    console.log(chalk.cyan('\n💡 Use --execute to perform the merge operation'));
    return;
  }

  // Final confirmation for destructive operation. --json promises
  // non-interactivity: refuse instead of hanging on a prompt.
  if (!options.force) {
    if (jsonMode) {
      fail(
        'merge',
        ExitCode.Precondition,
        'Merge requires confirmation: pass --force with --json',
        jsonMode,
      );
    }
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
  const backups: { source?: string; target?: string } = {};
  if (options.backupBoth) {
    const backupSpinner = jsonMode ? null : ora('Backing up both databases...').start();
    try {
      backups.source = await snapshotInstance(sourceInstance);
      backups.target = await snapshotInstance(targetInstance);
      backupSpinner?.succeed('Safety snapshots created');
      if (!jsonMode) {
        console.log(chalk.gray(`  source → ${backups.source}`));
        console.log(chalk.gray(`  target → ${backups.target}`));
      }
    } catch (error) {
      backupSpinner?.fail('Backup failed — aborting merge');
      fail(
        'merge',
        ExitCode.Error,
        `Safety backup failed, merge aborted: ${error instanceof Error ? error.message : error}`,
        jsonMode,
      );
    }
  }

  // Execute merge
  const spinner = jsonMode ? null : ora('Merging databases...').start();

  try {
    await mergeDatabases(sourceInstance, targetInstance);

    spinner?.succeed('Database merge completed successfully');
    await recordOperation({
      operation: 'merge',
      source: options.source,
      target: options.target,
      success: true,
    });

    if (jsonMode) {
      succeed(
        'merge',
        {
          executed: true,
          source: options.source,
          target: options.target,
          engine: sourceInstance.engine,
          backups: options.backupBoth ? backups : undefined,
        },
        jsonMode,
      );
      return;
    }

    console.log(chalk.green('\n✅ Merge operation completed!'));
    console.log(
      chalk.yellow(
        `💡 '${options.target}' now contains the combined data; '${options.source}' is unchanged`,
      ),
    );
    console.log(chalk.yellow('💡 Commands:'));
    console.log(`  • ${chalk.cyan('hayai list')} - View all databases`);
    console.log(`  • ${chalk.cyan('hayai studio')} - Open admin dashboards`);
  } catch (error) {
    spinner?.fail('Merge operation failed');
    await recordOperation({
      operation: 'merge',
      source: options.source,
      target: options.target,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    failFromError('merge', error, jsonMode);
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
  .option('--json', 'Machine-readable JSON output on stdout (implies non-interactive)')
  .addHelpText(
    'after',
    `
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
  • Key conflicts: PostgreSQL/MariaDB keep the target's row; Redis replaces
    the key with the source's value (MIGRATE … REPLACE)

${chalk.bold('Supported Engines (same engine on both sides):')}
  • PostgreSQL, MariaDB, MySQL: SQL-level merging (data-only)
  • Redis, Valkey: key-level merging with MIGRATE … COPY REPLACE

${chalk.bold('Unsupported:')}
  • Cross-engine pairs and any other engine are refused — there is no safe
    generic merge. Use ${chalk.cyan('hayai snapshot')} / ${chalk.cyan('hayai restore')} and the engine's tooling.
`,
  )
  .action(handleMerge);
