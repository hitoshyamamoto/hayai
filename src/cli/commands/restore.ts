import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import { spawn } from 'child_process';
import { getDockerManager } from '../../core/docker.js';
import { getPostgresExecCredentials, getMariaDBRootPassword } from '../../core/credentials.js';
import { recordOperation } from '../../core/security.js';
import { DatabaseInstance } from '../../core/types.js';

interface RestoreOptions {
  to?: string;
  force?: boolean;
  confirm?: boolean;
  verbose?: boolean;
}

const EMBEDDED_ENGINES = new Set(['sqlite', 'duckdb', 'leveldb', 'lmdb']);

// Engines whose snapshots we can put back deterministically. The rest are
// snapshot-only: their native dumps need engine-specific restore tooling, so
// we refuse rather than half-restore and corrupt the target.
const RESTORABLE_ENGINES = new Set([
  'postgresql',
  'timescaledb',
  'mariadb',
  'redis',
  ...EMBEDDED_ENGINES
]);

function showManualRestoreGuidance(engine: string): void {
  console.log(chalk.yellow('\n💡 Restore this engine with its native tooling:'));

  switch (engine) {
    case 'influxdb2':
      console.log(chalk.gray('  • influx restore /path/to/backup (unpack the .tar.gz first)'));
      break;
    case 'influxdb3':
      console.log(chalk.gray('  • Use the influxdb3 CLI / /api/v3 load endpoints'));
      break;
    case 'cassandra':
      console.log(chalk.gray('  • sstableloader, or restore the snapshot dir + nodetool refresh'));
      break;
    case 'qdrant':
      console.log(chalk.gray('  • Qdrant snapshots API: PUT /collections/<name>/snapshots/upload'));
      break;
    case 'meilisearch':
      console.log(chalk.gray('  • Launch with --import-dump <dump>'));
      break;
    default:
      console.log(chalk.gray(`  • Check the ${engine} documentation for its restore command`));
  }
}

// Streams a snapshot file into a client running inside the container (psql,
// mysql). The client reads the dump from stdin.
function restoreViaStdin(dockerArgs: string[], snapshotPath: string, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs, { stdio: ['pipe', 'inherit', 'pipe'] });
    const input = createReadStream(snapshotPath);

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    input.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      // psql/mysql exit non-zero on a fatal error; the benign "object does not
      // exist" noise from --clean dumps still exits 0.
      code === 0 ? resolve() : reject(new Error(`${label} restore failed: ${stderr.trim()}`));
    });

    input.pipe(child.stdin);
  });
}

async function restorePostgreSQL(container: string, snapshotPath: string, env: Record<string, string>): Promise<void> {
  const { user } = getPostgresExecCredentials(env);
  // The dump was taken with --create, so connect to the maintenance database;
  // it recreates and reconnects to the target database itself.
  await restoreViaStdin(['exec', '-i', container, 'psql', '-U', user, '-d', 'postgres'], snapshotPath, 'PostgreSQL');
}

async function restoreMariaDB(container: string, snapshotPath: string, env: Record<string, string>): Promise<void> {
  const password = getMariaDBRootPassword(env);
  // --all-databases dumps carry their own CREATE DATABASE / USE statements.
  await restoreViaStdin(
    ['exec', '-i', '-e', `MYSQL_PWD=${password}`, container, 'mysql', '-u', 'root'],
    snapshotPath,
    'MariaDB'
  );
}

async function restoreRedis(instanceName: string, snapshotPath: string): Promise<void> {
  const dockerManager = getDockerManager();
  const container = `${instanceName}-db`;

  // Redis only loads an RDB at startup, so swap the file with the server down.
  await dockerManager.stopDatabase(instanceName);
  await new Promise<void>((resolve, reject) => {
    const cp = spawn('docker', ['cp', snapshotPath, `${container}:/data/dump.rdb`]);
    cp.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Failed to copy RDB into container'))));
    cp.on('error', reject);
  });
  await dockerManager.startDatabase(instanceName);
}

async function restoreEmbedded(volume: string, snapshotPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', snapshotPath, '-C', volume]);
    tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Failed to extract embedded snapshot'))));
    tar.on('error', reject);
  });
}

async function restoreInto(instance: DatabaseInstance, snapshotPath: string): Promise<void> {
  const container = `${instance.name}-db`;

  if (EMBEDDED_ENGINES.has(instance.engine)) {
    await restoreEmbedded(instance.volume, snapshotPath);
    return;
  }

  switch (instance.engine) {
    case 'postgresql':
    case 'timescaledb':
      await restorePostgreSQL(container, snapshotPath, instance.environment);
      break;
    case 'mariadb':
      await restoreMariaDB(container, snapshotPath, instance.environment);
      break;
    case 'redis':
      await restoreRedis(instance.name, snapshotPath);
      break;
    default:
      // Guarded by RESTORABLE_ENGINES before we get here.
      throw new Error(`Restore is not implemented for engine: ${instance.engine}`);
  }
}

// Accepts a path or a bare filename; bare names resolve against ./snapshots.
async function resolveSnapshotPath(input: string): Promise<string> {
  const candidates = [input, path.join('./snapshots', input)];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return path.resolve(candidate);
    } catch {
      // try next
    }
  }
  throw new Error(`Snapshot file not found: ${input}`);
}

async function handleRestore(snapshot: string, options: RestoreOptions): Promise<void> {
  let snapshotPath: string;
  try {
    snapshotPath = await resolveSnapshotPath(snapshot);
  } catch (error) {
    console.error(chalk.red(`❌ ${error instanceof Error ? error.message : error}`));
    console.log(chalk.yellow('💡 List snapshots with: ') + chalk.cyan('hayai snapshot list'));
    process.exit(1);
  }

  // The snapshot filename encodes the source instance: <name>-snapshot-<ts>.<ext>
  const inferredName = path.basename(snapshotPath).split('-snapshot-')[0];
  const targetName = options.to || inferredName;

  const dockerManager = getDockerManager();
  await dockerManager.initialize();

  const instance = dockerManager.getInstance(targetName);
  if (!instance) {
    console.error(chalk.red(`❌ Target database '${targetName}' not found`));
    console.log(chalk.yellow('💡 Pass an existing instance with --to, or run `hayai list`'));
    process.exit(1);
  }

  if (!RESTORABLE_ENGINES.has(instance.engine)) {
    console.error(chalk.red(`❌ Restore is not supported for '${instance.engine}'`));
    showManualRestoreGuidance(instance.engine);
    process.exit(1);
  }

  if (instance.status !== 'running' && instance.status !== 'embedded') {
    console.error(chalk.red(`❌ Target '${targetName}' must be running to restore into it`));
    console.log(chalk.yellow(`💡 Start it with: ${chalk.cyan(`hayai start ${targetName}`)}`));
    process.exit(1);
  }

  console.log(chalk.cyan('\n🔁 Restore Plan:'));
  console.log(chalk.gray(`Snapshot: ${snapshotPath}`));
  console.log(chalk.gray(`Target:   ${targetName} (${instance.engine})`));
  console.log(chalk.yellow('\n⚠️  This overwrites the data currently in the target.'));

  if (!options.confirm && !options.force) {
    const { proceed } = await inquirer.prompt([
      { type: 'confirm', name: 'proceed', message: `Restore into '${targetName}'?`, default: false }
    ]);
    if (!proceed) {
      console.log(chalk.yellow('Operation cancelled'));
      return;
    }
  }

  const spinner = ora(`Restoring into '${targetName}'...`).start();
  try {
    await restoreInto(instance, snapshotPath);
    spinner.succeed(`Restored '${targetName}' from snapshot`);
    await recordOperation({ operation: 'restore', source: path.basename(snapshotPath), target: targetName, success: true });

    console.log(chalk.green('\n✅ Restore completed!'));
    console.log(chalk.yellow('💡 Verify with: ') + chalk.cyan('hayai studio'));
  } catch (error) {
    spinner.fail('Restore failed');
    await recordOperation({
      operation: 'restore',
      source: path.basename(snapshotPath),
      target: targetName,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
    console.error(chalk.red('\n❌ Restore failed:'), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

export const restoreCommand = new Command('restore')
  .description('Restore a database instance from a snapshot')
  .argument('<snapshot>', 'Snapshot file (path, or a name under ./snapshots)')
  .option('-t, --to <name>', 'Target instance (default: inferred from the snapshot filename)')
  .option('-y, --confirm', 'Skip the confirmation prompt')
  .option('--force', 'Skip the confirmation prompt')
  .option('--verbose', 'Enable verbose output')
  .addHelpText('after', `
${chalk.bold('Supported engines:')}
  ${chalk.green('✅ postgresql, timescaledb')}  - psql replays the SQL dump
  ${chalk.green('✅ mariadb')}                  - mysql replays the SQL dump
  ${chalk.green('✅ redis')}                    - RDB swapped in with the server stopped
  ${chalk.green('✅ sqlite, duckdb, leveldb, lmdb')} - data directory extracted in place

${chalk.bold('Not supported (snapshot-only):')}
  ${chalk.red('❌ influxdb2/3, cassandra, qdrant, weaviate, milvus, meilisearch, ...')}
  ${chalk.gray('These snapshot fine but need engine-native restore tooling.')}

${chalk.bold('Examples:')}
  ${chalk.cyan('# Restore into the instance named in the snapshot file')}
  hayai restore mydb-snapshot-2026-06-22T10-00-00-000Z.sql

  ${chalk.cyan('# Restore a snapshot into a different instance')}
  hayai restore ./snapshots/prod-snapshot-....sql --to staging -y
`)
  .action(handleRestore);
