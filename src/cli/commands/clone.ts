import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { getDockerManager } from '../../core/docker.js';
import { resolveServiceContainer } from '../../core/containers.js';
import { getTemplate } from '../../core/templates.js';
import { getPostgresExecCredentials, getMariaDBRootPassword } from '../../core/credentials.js';
import { recordOperation } from '../../core/security.js';
import { CLIOptions } from '../../core/types.js';
import { spawn } from 'child_process';
import { cp } from 'fs/promises';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

interface CloneOptions extends CLIOptions {
  from: string;
  to?: string;
  toMultiple?: string;
  confirm?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

// Engines with a reliable native clone implementation
const FULLY_COMPATIBLE_ENGINES = new Set([
  'postgresql', // pg_dump + psql
  'mariadb', // mariadb-dump + mariadb
  'mysql', // mysqldump + mysql
  'redis', // BGSAVE + RDB copy
  'valkey', // BGSAVE + RDB copy (valkey-cli)
  'sqlite', // host file copy (embedded)
  'duckdb', // host file copy (embedded)
  'leveldb', // host file copy (embedded)
  'lmdb', // host file copy (embedded)
]);

const EMBEDDED_ENGINES = new Set(['sqlite', 'duckdb', 'leveldb', 'lmdb']);

function validateCloneCompatibility(sourceEngine: string): {
  compatible: boolean;
  reason?: string;
} {
  if (!FULLY_COMPATIBLE_ENGINES.has(sourceEngine)) {
    return {
      compatible: false,
      reason: `Engine '${sourceEngine}' uses generic backup which may be unreliable`,
    };
  }

  return { compatible: true };
}

function showManualCloneGuidance(engine: string): void {
  console.log(chalk.yellow('\n💡 Manual Clone Guidance:'));

  switch (engine) {
    case 'cassandra':
      console.log(chalk.gray('  • Use: nodetool snapshot + sstableloader'));
      console.log(chalk.gray('  • Or: cqlsh COPY commands'));
      break;
    case 'influxdb2':
      console.log(chalk.gray('  • Use: influx backup + influx restore'));
      break;
    case 'influxdb3':
      console.log(chalk.gray('  • Use: influx3 export + influx3 import'));
      break;
    case 'qdrant':
      console.log(chalk.gray('  • Use: Qdrant snapshots API'));
      console.log(chalk.gray('  • Or: /collections/{collection}/snapshots'));
      break;
    case 'meilisearch':
      console.log(chalk.gray('  • Use: dumps API endpoint'));
      console.log(chalk.gray('  • POST /dumps + GET /dumps/{dumpUid}'));
      break;
    case 'milvus':
      console.log(chalk.gray('  • Use: Milvus backup tool'));
      console.log(chalk.gray('  • Or: collection export/import'));
      break;
    case 'arangodb':
      console.log(chalk.gray('  • Use: arangodump + arangorestore'));
      break;
    case 'timescaledb':
      console.log(chalk.gray('  • Use: pg_dump (TimescaleDB extensions)'));
      console.log(chalk.gray('  • Include: --extension timescaledb'));
      break;
    default:
      console.log(chalk.gray(`  • Check ${engine} documentation for native backup/restore tools`));
      console.log(chalk.gray('  • Use engine-specific export/import commands'));
      console.log(chalk.gray('  • Consider data migration tools or scripts'));
  }

  console.log(chalk.yellow('\n📚 Alternative Options:'));
  console.log(chalk.gray('  • Use database-specific migration tools'));
  console.log(chalk.gray('  • Write custom data transfer scripts'));
  console.log(chalk.gray('  • Use hayai studio to access admin dashboards'));
  console.log(chalk.cyan('  • Run: hayai studio --help'));
}

async function executeClone(sourceInstance: any, targetName: string): Promise<void> {
  const dockerManager = getDockerManager();

  // Get source template
  const sourceTemplate = getTemplate(sourceInstance.engine);
  if (!sourceTemplate) {
    throw new Error(`Template not found for engine: ${sourceInstance.engine}`);
  }

  console.log(chalk.cyan(`🔄 Cloning ${sourceInstance.name} → ${targetName}...`));

  // Create target database with same configuration
  const targetInstance = await dockerManager.createDatabase(targetName, sourceTemplate, {
    port: undefined, // Let it auto-allocate
    customEnv: { ...sourceInstance.environment },
  });

  if (targetInstance.status !== 'embedded') {
    // Start target database
    await dockerManager.startDatabase(targetName);

    // Wait for database to be ready
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Clone data based on database type
  await cloneData(sourceInstance, targetInstance);

  console.log(chalk.green(`✅ Successfully cloned ${sourceInstance.name} → ${targetName}`));
}

async function cloneData(source: any, target: any): Promise<void> {
  if (EMBEDDED_ENGINES.has(source.engine)) {
    // Embedded engines are host files — copy the data directory directly
    await cp(source.volume, target.volume, { recursive: true, force: true });
    return;
  }

  // Compose names containers '<project>-<service>-<n>'; resolve the real ones
  // before any docker exec/cp.
  const sourceContainer = await resolveServiceContainer(source.name);
  const targetContainer = await resolveServiceContainer(target.name);

  switch (source.engine) {
    case 'postgresql':
      await clonePostgreSQL(sourceContainer, targetContainer, source.environment);
      break;
    case 'mariadb':
      await cloneMariaDB(sourceContainer, targetContainer, source.environment, {
        dump: 'mariadb-dump',
        client: 'mariadb',
      });
      break;
    case 'mysql':
      await cloneMariaDB(sourceContainer, targetContainer, source.environment, {
        dump: 'mysqldump',
        client: 'mysql',
      });
      break;
    case 'redis':
      await cloneRedis(sourceContainer, targetContainer, target.name, 'redis-cli');
      break;
    case 'valkey':
      await cloneRedis(sourceContainer, targetContainer, target.name, 'valkey-cli');
      break;
    default:
      // This situation should never happen due to compatibility validation
      throw new Error(`Unsupported engine for cloning: ${source.engine}`);
  }
}

async function clonePostgreSQL(
  sourceContainer: string,
  targetContainer: string,
  environment: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    // The target is freshly created with the same environment, so the
    // same-named empty database already exists there — a plain dump/restore
    // into it is enough.
    const { user, database } = getPostgresExecCredentials(environment);
    const dumpProcess = spawn(
      'docker',
      ['exec', sourceContainer, 'pg_dump', '-U', user, '-d', database],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const restoreProcess = spawn(
      'docker',
      ['exec', '-i', targetContainer, 'psql', '-U', user, '-d', database],
      { stdio: ['pipe', 'inherit', 'pipe'] },
    );

    dumpProcess.stdout.pipe(restoreProcess.stdin);

    restoreProcess.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error('PostgreSQL clone failed'));
    });

    dumpProcess.on('error', reject);
    restoreProcess.on('error', reject);
  });
}

async function cloneMariaDB(
  sourceContainer: string,
  targetContainer: string,
  environment: Record<string, string> = {},
  binaries: { dump: string; client: string } = { dump: 'mariadb-dump', client: 'mariadb' },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rootPassword = getMariaDBRootPassword(environment);
    const dumpTarget = environment.MYSQL_DATABASE
      ? ['--databases', environment.MYSQL_DATABASE]
      : ['--all-databases'];
    const dumpProcess = spawn(
      'docker',
      [
        'exec',
        '-e',
        `MYSQL_PWD=${rootPassword}`,
        sourceContainer,
        binaries.dump,
        '-u',
        'root',
        ...dumpTarget,
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const restoreProcess = spawn(
      'docker',
      [
        'exec',
        '-i',
        '-e',
        `MYSQL_PWD=${rootPassword}`,
        targetContainer,
        binaries.client,
        '-u',
        'root',
      ],
      { stdio: ['pipe', 'inherit', 'pipe'] },
    );

    dumpProcess.stdout.pipe(restoreProcess.stdin);

    restoreProcess.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error('MariaDB clone failed'));
    });

    dumpProcess.on('error', reject);
    restoreProcess.on('error', reject);
  });
}

function runDockerStep(args: string[], failureMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(failureMessage))));
    child.on('error', reject);
  });
}

async function cloneRedis(
  sourceContainer: string,
  targetContainer: string,
  targetName: string,
  cli: string = 'redis-cli',
): Promise<void> {
  // Persist the source dataset to its RDB file
  await runDockerStep(['exec', sourceContainer, cli, 'BGSAVE'], 'Redis backup failed');
  await new Promise((resolve) => setTimeout(resolve, 2000));

  await runDockerStep(
    ['cp', `${sourceContainer}:/data/dump.rdb`, '/tmp/redis-clone.rdb'],
    'Failed to copy Redis data',
  );

  // The RDB must land while the target is down: Redis rewrites dump.rdb on
  // shutdown, so copying into a running server gets clobbered by its own
  // (empty) dataset when it stops.
  const dockerManager = getDockerManager();
  await dockerManager.stopDatabase(targetName);
  await runDockerStep(
    ['cp', '/tmp/redis-clone.rdb', `${targetContainer}:/data/dump.rdb`],
    'Failed to restore Redis data',
  );
  await dockerManager.startDatabase(targetName);
}

async function handleClone(options: CloneOptions): Promise<void> {
  const jsonMode = Boolean(options.json);
  const dockerManager = getDockerManager();
  await dockerManager.initialize();

  // Validate source database
  const sourceInstance = dockerManager.getInstance(options.from);
  if (!sourceInstance) {
    fail(
      'clone',
      ExitCode.NotFound,
      `Source database '${options.from}' not found`,
      jsonMode,
      'Run `hayai list` to see available databases',
    );
  }

  // Check if source is running (embedded engines have no server to run)
  if (sourceInstance.status !== 'running' && sourceInstance.status !== 'embedded') {
    fail(
      'clone',
      ExitCode.Precondition,
      `Source database '${options.from}' must be running`,
      jsonMode,
      `Start it with: hayai start ${options.from}`,
    );
  }

  // Validate compatibility
  const compatibilityResult = validateCloneCompatibility(sourceInstance.engine);
  if (!compatibilityResult.compatible) {
    if (!jsonMode) {
      showManualCloneGuidance(sourceInstance.engine);
    }
    fail(
      'clone',
      ExitCode.Precondition,
      `Source engine '${sourceInstance.engine}' is not fully compatible for cloning: ${compatibilityResult.reason}`,
      jsonMode,
    );
  }

  // Determine target databases
  let targetNames: string[] = [];

  if (options.to) {
    targetNames = [options.to];
  } else if (options.toMultiple) {
    targetNames = options.toMultiple.split(',').map((name) => name.trim());
  } else {
    fail(
      'clone',
      ExitCode.Usage,
      'Must specify target database(s)',
      jsonMode,
      'Use --to or --to-multiple',
    );
  }

  // Validate target names
  for (const targetName of targetNames) {
    if (dockerManager.getInstance(targetName)) {
      if (!options.force) {
        fail(
          'clone',
          ExitCode.Conflict,
          `Target database '${targetName}' already exists`,
          jsonMode,
          'Use --force to overwrite existing databases',
        );
      }
    }
  }

  // Show preview
  if (!jsonMode) {
    console.log(chalk.cyan('\n🔍 Clone Preview:'));
    console.log(chalk.gray(`Source: ${options.from} (${sourceInstance.engine})`));
    console.log(chalk.gray(`Targets: ${targetNames.join(', ')}`));
  }

  if (options.dryRun) {
    if (jsonMode) {
      succeed(
        'clone',
        { dryRun: true, from: options.from, engine: sourceInstance.engine, targets: targetNames },
        jsonMode,
      );
      return;
    }
    console.log(chalk.yellow('\n🚧 Dry run - no actual cloning performed'));
    return;
  }

  // Confirmation. --json promises non-interactivity: refuse instead of prompting.
  if (!options.confirm && !options.force) {
    if (jsonMode) {
      fail(
        'clone',
        ExitCode.Precondition,
        'Clone requires confirmation: pass -y or --force with --json',
        jsonMode,
      );
    }
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: `Clone ${options.from} to ${targetNames.length} database(s)?`,
        default: false,
      },
    ]);

    if (!proceed) {
      console.log(chalk.yellow('Operation cancelled'));
      return;
    }
  }

  // Execute clones
  const spinner = jsonMode ? null : ora('Cloning databases...').start();

  try {
    for (let i = 0; i < targetNames.length; i++) {
      const targetName = targetNames[i];
      if (spinner) {
        spinner.text = `Cloning ${options.from} → ${targetName} (${i + 1}/${targetNames.length})`;
      }

      // Remove existing if force
      if (options.force && dockerManager.getInstance(targetName)) {
        await dockerManager.removeDatabase(targetName);
      }

      await executeClone(sourceInstance, targetName);
      await recordOperation({
        operation: 'clone',
        source: options.from,
        target: targetName,
        success: true,
      });
    }

    spinner?.succeed(`Successfully cloned ${options.from} to ${targetNames.length} database(s)`);

    if (jsonMode) {
      succeed(
        'clone',
        { from: options.from, engine: sourceInstance.engine, targets: targetNames },
        jsonMode,
      );
      return;
    }

    console.log(chalk.green('\n✅ Clone operation completed!'));
    console.log(chalk.yellow('💡 Commands:'));
    console.log(`  • ${chalk.cyan('hayai list')} - View all databases`);
    console.log(`  • ${chalk.cyan('hayai studio')} - Open admin dashboards`);
  } catch (error) {
    spinner?.fail('Clone operation failed');
    await recordOperation({
      operation: 'clone',
      source: options.from,
      target: targetNames.join(','),
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    failFromError('clone', error, jsonMode);
  }
}

export const cloneCommand = new Command('clone')
  .description('Clone database instances (compatible engines only)')
  .option('-f, --from <name>', 'Source database name')
  .option('-t, --to <name>', 'Target database name (1:1 clone)')
  .option('--tm, --to-multiple <names>', 'Target database names (comma-separated, 1:N clone)')
  .option('-y, --confirm', 'Skip confirmation prompt')
  .option('--force', 'Overwrite existing target databases')
  .option('--dry-run', 'Show what would be cloned without executing')
  .option('--verbose', 'Enable verbose output')
  .option('--json', 'Machine-readable JSON output on stdout (implies non-interactive)')
  .addHelpText(
    'after',
    `
${chalk.bold('Supported Engines (Fully Compatible):')}
  ${chalk.green('✅ postgresql')}   - Native pg_dump + psql
  ${chalk.green('✅ mariadb, mysql')} - Native dump + replay with each image's client
  ${chalk.green('✅ redis, valkey')} - Native BGSAVE + RDB copy
  ${chalk.green('✅ sqlite, duckdb, leveldb, lmdb')} - Host file copy (embedded)

${chalk.bold('Unsupported Engines (Manual Clone Required):')}
  ${chalk.red('❌ cassandra, influxdb2, influxdb3, timescaledb, questdb')}
  ${chalk.red('❌ qdrant, weaviate, milvus, arangodb, nebula')}
  ${chalk.red('❌ meilisearch, typesense, victoriametrics, horaedb')}
  ${chalk.red('❌ tikv')}

${chalk.bold('Examples:')}
  ${chalk.cyan('# Clone PostgreSQL database')}
  hayai clone --from prod-postgres --to staging-postgres
  hayai clone -f prod-postgres -t staging-postgres -y

  ${chalk.cyan('# Clone Redis to multiple instances')}
  hayai clone --from cache-redis --to-multiple "test1,test2,test3"
  hayai clone -f cache-redis --tm "dev,staging,qa" -y

  ${chalk.cyan('# Safe cloning with preview')}
  hayai clone -f prod-mariadb -t staging-mariadb --dry-run

${chalk.bold('Visual Syntax (alternative):')}
  ${chalk.cyan('hayai clone postgres-prod → postgres-staging')}    ${chalk.gray('# Simple clone')}
  ${chalk.cyan('hayai clone redis-cache → redis1,redis2')}         ${chalk.gray('# Multiple targets')}

${chalk.bold('For unsupported engines:')}
  ${chalk.yellow('Use engine-specific tools:')} cassandra (nodetool), influx (backup/restore)
  ${chalk.yellow('Access admin dashboards:')} hayai studio
  ${chalk.yellow('Manual data migration:')} Write custom scripts or use migration tools
`,
  )
  .action(handleClone);
