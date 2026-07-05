import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { getDockerManager } from '../../core/docker.js';
import { resolveServiceContainer } from '../../core/containers.js';
import { getTemplate } from '../../core/templates.js';
import { getPostgresExecCredentials, getMariaDBRootPassword } from '../../core/credentials.js';
import { recordOperation } from '../../core/security.js';
import { DatabaseInstance, SnapshotOptions } from '../../core/types.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

async function createSnapshotDirectory(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

const EMBEDDED_ENGINES = new Set(['sqlite', 'duckdb', 'leveldb', 'lmdb']);

async function createSnapshot(instance: any, snapshotPath: string): Promise<void> {
  const template = getTemplate(instance.engine);
  if (!template) {
    throw new Error(`Template not found for engine: ${instance.engine}`);
  }

  // Embedded engines are host files — archive the data directory directly
  if (EMBEDDED_ENGINES.has(instance.engine)) {
    await createEmbeddedSnapshot(instance.volume, snapshotPath);
    return;
  }

  // Compose names containers '<project>-<service>-<n>'; resolve the real one
  // before any docker exec/cp.
  const container = await resolveServiceContainer(instance.name);

  // Choose appropriate backup method based on database type
  switch (instance.engine) {
    case 'postgresql':
    case 'timescaledb':
      await createPostgreSQLSnapshot(container, snapshotPath, instance.environment);
      break;
    case 'mariadb':
      // mariadb:11 ships only the mariadb-* client names
      await createMariaDBSnapshot(container, snapshotPath, instance.environment, 'mariadb-dump');
      break;
    case 'mysql':
      await createMariaDBSnapshot(container, snapshotPath, instance.environment, 'mysqldump');
      break;
    case 'redis':
      await createRedisSnapshot(container, snapshotPath, 'redis-cli');
      break;
    case 'valkey':
      await createRedisSnapshot(container, snapshotPath, 'valkey-cli');
      break;
    case 'influxdb2':
    case 'influxdb3':
      await createInfluxDBSnapshot(container, snapshotPath);
      break;
    case 'cassandra':
      await createCassandraSnapshot(container, snapshotPath);
      break;
    default:
      await createGenericSnapshot(container, snapshotPath);
  }
}

async function createPostgreSQLSnapshot(
  container: string,
  snapshotPath: string,
  environment: Record<string, string> = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { user, database } = getPostgresExecCredentials(environment);
    const dumpProcess = spawn(
      'docker',
      ['exec', container, 'pg_dump', '-U', user, '-d', database, '--clean', '--create'],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const writeStream = createWriteStream(snapshotPath);
    dumpProcess.stdout.pipe(writeStream);

    dumpProcess.on('close', (code) => {
      writeStream.end();
      code === 0 ? resolve() : reject(new Error('PostgreSQL snapshot failed'));
    });

    dumpProcess.on('error', reject);
  });
}

async function createMariaDBSnapshot(
  container: string,
  snapshotPath: string,
  environment: Record<string, string> = {},
  dumpBinary: string = 'mariadb-dump',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rootPassword = getMariaDBRootPassword(environment);
    const dumpProcess = spawn(
      'docker',
      [
        'exec',
        '-e',
        `MYSQL_PWD=${rootPassword}`,
        container,
        dumpBinary,
        '-u',
        'root',
        '--all-databases',
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    );

    const writeStream = createWriteStream(snapshotPath);
    dumpProcess.stdout.pipe(writeStream);

    dumpProcess.on('close', (code) => {
      writeStream.end();
      code === 0 ? resolve() : reject(new Error('MariaDB snapshot failed'));
    });

    dumpProcess.on('error', reject);
  });
}

async function createRedisSnapshot(
  container: string,
  snapshotPath: string,
  cli: string = 'redis-cli',
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create RDB backup
    const bgsaveProcess = spawn('docker', ['exec', container, cli, 'BGSAVE']);

    bgsaveProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Redis background save failed'));
        return;
      }

      // Wait for backup to complete
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Copy RDB file
      const copyProcess = spawn('docker', ['cp', `${container}:/data/dump.rdb`, snapshotPath]);

      copyProcess.on('close', (copyCode) => {
        copyCode === 0 ? resolve() : reject(new Error('Failed to copy Redis snapshot'));
      });

      copyProcess.on('error', reject);
    });

    bgsaveProcess.on('error', reject);
  });
}

async function createInfluxDBSnapshot(container: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const backupProcess = spawn('docker', ['exec', container, 'influx', 'backup', '/tmp/backup']);

    backupProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('InfluxDB backup failed'));
        return;
      }

      // Create tar archive
      const tarProcess = spawn('docker', [
        'exec',
        container,
        'tar',
        '-czf',
        '/tmp/influx-backup.tar.gz',
        '/tmp/backup',
      ]);

      tarProcess.on('close', (tarCode) => {
        if (tarCode !== 0) {
          reject(new Error('Failed to create backup archive'));
          return;
        }

        // Copy to host
        const copyProcess = spawn('docker', [
          'cp',
          `${container}:/tmp/influx-backup.tar.gz`,
          snapshotPath,
        ]);

        copyProcess.on('close', (copyCode) => {
          copyCode === 0 ? resolve() : reject(new Error('Failed to copy InfluxDB snapshot'));
        });

        copyProcess.on('error', reject);
      });

      tarProcess.on('error', reject);
    });

    backupProcess.on('error', reject);
  });
}

async function createEmbeddedSnapshot(volumePath: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tarProcess = spawn('tar', ['-czf', snapshotPath, '-C', volumePath, '.']);

    tarProcess.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error('Embedded database snapshot failed'));
    });

    tarProcess.on('error', reject);
  });
}

async function createGenericSnapshot(container: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const backupProcess = spawn('docker', [
      'exec',
      container,
      'tar',
      '-czf',
      '/tmp/backup.tar.gz',
      '/data',
    ]);

    backupProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Generic backup failed'));
        return;
      }

      const copyProcess = spawn('docker', ['cp', `${container}:/tmp/backup.tar.gz`, snapshotPath]);

      copyProcess.on('close', (copyCode) => {
        copyCode === 0 ? resolve() : reject(new Error('Failed to copy generic snapshot'));
      });

      copyProcess.on('error', reject);
    });

    backupProcess.on('error', reject);
  });
}

async function createCassandraSnapshot(container: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const snapshotProcess = spawn('docker', ['exec', container, 'nodetool', 'snapshot']);

    snapshotProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Cassandra snapshot failed'));
        return;
      }

      const copyProcess = spawn('docker', [
        'exec',
        container,
        'tar',
        '-czf',
        '/tmp/cassandra-snapshot.tar.gz',
        '/var/lib/cassandra/data',
      ]);

      copyProcess.on('close', (tarCode) => {
        if (tarCode !== 0) {
          reject(new Error('Failed to create Cassandra archive'));
          return;
        }

        const finalCopyProcess = spawn('docker', [
          'cp',
          `${container}:/tmp/cassandra-snapshot.tar.gz`,
          snapshotPath,
        ]);

        finalCopyProcess.on('close', (copyCode) => {
          copyCode === 0 ? resolve() : reject(new Error('Failed to copy Cassandra snapshot'));
        });

        finalCopyProcess.on('error', reject);
      });

      copyProcess.on('error', reject);
    });

    snapshotProcess.on('error', reject);
  });
}

// The snapshot file extension follows the engine's native backup format.
function snapshotExtension(engine: string): string {
  if (engine === 'redis' || engine === 'valkey') return 'rdb';
  if (engine.includes('influx') || engine === 'cassandra') return 'tar.gz';
  if (EMBEDDED_ENGINES.has(engine)) return 'tar.gz';
  return 'sql';
}

// Writes a timestamped snapshot of an instance and returns its path. Shared by
// the snapshot command and by `merge --backup-both`.
export async function snapshotInstance(
  instance: DatabaseInstance,
  outputDir = './snapshots',
): Promise<string> {
  await createSnapshotDirectory(outputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(
    outputDir,
    `${instance.name}-snapshot-${timestamp}.${snapshotExtension(instance.engine)}`,
  );
  await createSnapshot(instance, snapshotPath);
  return snapshotPath;
}

export const snapshotCommand = new Command('snapshot')
  .description('Create snapshots of database instances')
  .argument('<name>', 'Database instance name')
  .option('-o, --output <path>', 'Output directory for snapshots', './snapshots')
  .option('--json', 'Machine-readable JSON output on stdout')
  .action(async (name: string, options: SnapshotOptions & { json?: boolean }) => {
    const jsonMode = Boolean(options.json);
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      const instance = dockerManager.getInstance(name);
      if (!instance) {
        fail(
          'snapshot',
          ExitCode.NotFound,
          `Database instance '${name}' not found`,
          jsonMode,
          'Run `hayai list` to see available databases',
        );
      }

      if (instance.status !== 'running' && instance.status !== 'embedded') {
        fail(
          'snapshot',
          ExitCode.Precondition,
          `Database '${name}' must be running to create snapshot`,
          jsonMode,
          `Start it with: hayai start ${name}`,
        );
      }

      const outputDir = options.output || './snapshots';

      if (!jsonMode) {
        console.log(chalk.cyan(`📸 Creating snapshot of '${name}'...`));
        console.log(chalk.gray(`Engine: ${instance.engine}`));
      }

      const spinner = jsonMode ? null : ora('Creating snapshot...').start();

      let snapshotPath: string;
      try {
        snapshotPath = await snapshotInstance(instance, outputDir);
      } catch (error) {
        spinner?.fail('Snapshot failed');
        await recordOperation({
          operation: 'snapshot',
          source: name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const stats = await fs.stat(snapshotPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      spinner?.succeed(`Snapshot created successfully (${fileSizeMB} MB)`);
      await recordOperation({
        operation: 'snapshot',
        source: name,
        target: snapshotPath,
        success: true,
      });

      if (jsonMode) {
        succeed(
          'snapshot',
          {
            source: name,
            engine: instance.engine,
            snapshot: snapshotPath,
            sizeMB: Number(fileSizeMB),
          },
          jsonMode,
        );
        return;
      }

      console.log(chalk.gray(`Output: ${snapshotPath}`));
      console.log(chalk.green('\n✅ Snapshot completed!'));
      console.log(chalk.yellow('💡 Commands:'));
      console.log(`  • ${chalk.cyan('hayai snapshot list')} - View all snapshots`);
      console.log(
        `  • ${chalk.cyan(`hayai restore ${path.basename(snapshotPath)}`)} - Restore this snapshot`,
      );
    } catch (error) {
      failFromError('snapshot', error, jsonMode);
    }
  });

// Add subcommand for listing snapshots
snapshotCommand
  .command('list')
  .description('List all available snapshots')
  .option('-d, --directory <path>', 'Snapshots directory', './snapshots')
  .action(async (options) => {
    try {
      const snapshotsDir = path.resolve(options.directory);

      try {
        await fs.access(snapshotsDir);
      } catch {
        console.log(chalk.yellow(`📁 No snapshots directory found at: ${snapshotsDir}`));
        console.log(chalk.gray('Create snapshots with: hayai snapshot <database-name>'));
        return;
      }

      const files = await fs.readdir(snapshotsDir);
      const snapshotFiles = files.filter(
        (file) =>
          file.includes('-snapshot-') &&
          (file.endsWith('.sql') || file.endsWith('.rdb') || file.endsWith('.tar.gz')),
      );

      if (snapshotFiles.length === 0) {
        console.log(chalk.yellow('📁 No snapshots found'));
        console.log(chalk.gray('Create snapshots with: hayai snapshot <database-name>'));
        return;
      }

      console.log(chalk.cyan('\n📋 Available Snapshots:\n'));

      // Get detailed info for each snapshot
      const snapshots = await Promise.all(
        snapshotFiles.map(async (file) => {
          const filePath = path.join(snapshotsDir, file);
          const stats = await fs.stat(filePath);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

          const dbName = file.split('-snapshot-')[0];
          const format = file.endsWith('.tar.gz') ? 'tar.gz' : path.extname(file).slice(1);

          return {
            file,
            dbName,
            // The filename timestamp is lossy (':' and '.' replaced) — the
            // file's mtime is the reliable creation record.
            timestamp: stats.mtime,
            size: sizeMB,
            format,
          };
        }),
      );

      // Sort by timestamp (newest first)
      snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      snapshots.forEach((snapshot) => {
        console.log(`📸 ${chalk.bold(snapshot.file)}`);
        console.log(`   Database: ${chalk.cyan(snapshot.dbName)}`);
        console.log(`   Created:  ${chalk.gray(snapshot.timestamp.toLocaleString())}`);
        console.log(`   Size:     ${chalk.yellow(snapshot.size)} MB`);
        console.log(`   Format:   ${chalk.magenta(snapshot.format)}`);
        console.log('');
      });

      console.log(chalk.yellow('💡 Commands:'));
      console.log(`  • ${chalk.cyan('hayai snapshot <name>')} - Create new snapshot`);
      console.log(`  • ${chalk.cyan('hayai snapshot clean')} - Remove old snapshots`);
    } catch (error) {
      console.error(
        chalk.red('❌ Failed to list snapshots:'),
        error instanceof Error ? error.message : error,
      );
    }
  });

// Add subcommand for removing old snapshots
snapshotCommand
  .command('clean')
  .description('Remove old snapshots (keeps last 5 per database)')
  .option('-d, --directory <path>', 'Snapshots directory', './snapshots')
  .option('-k, --keep <number>', 'Number of snapshots to keep per database', '5')
  .action(async (options) => {
    try {
      const snapshotsDir = path.resolve(options.directory);

      try {
        await fs.access(snapshotsDir);
      } catch {
        console.log(chalk.yellow(`📁 No snapshots directory found at: ${snapshotsDir}`));
        return;
      }

      const files = await fs.readdir(snapshotsDir);
      const snapshotFiles = files.filter(
        (file) =>
          file.includes('-snapshot-') &&
          (file.endsWith('.sql') || file.endsWith('.rdb') || file.endsWith('.tar.gz')),
      );

      if (snapshotFiles.length === 0) {
        console.log(chalk.yellow('📁 No snapshots found to clean'));
        return;
      }

      // Group by database name
      const snapshotsByDb: Record<string, string[]> = {};

      snapshotFiles.forEach((file) => {
        const dbName = file.split('-snapshot-')[0];
        if (!snapshotsByDb[dbName]) {
          snapshotsByDb[dbName] = [];
        }
        snapshotsByDb[dbName].push(file);
      });

      const keepCount = parseInt(options.keep);
      let totalDeleted = 0;

      for (const [dbName, snapshots] of Object.entries(snapshotsByDb)) {
        // Sort by timestamp (newest first)
        snapshots.sort((a, b) => {
          const timestampA = a.split('-snapshot-')[1]?.split('.')[0] || '';
          const timestampB = b.split('-snapshot-')[1]?.split('.')[0] || '';
          return timestampB.localeCompare(timestampA);
        });

        const toDelete = snapshots.slice(keepCount);

        if (toDelete.length > 0) {
          console.log(
            chalk.yellow(`🗑️  Cleaning ${dbName}: removing ${toDelete.length} old snapshots`),
          );

          for (const file of toDelete) {
            await fs.unlink(path.join(snapshotsDir, file));
            console.log(chalk.gray(`   Deleted: ${file}`));
            totalDeleted++;
          }
        }
      }

      if (totalDeleted === 0) {
        console.log(chalk.green('✅ No old snapshots to clean'));
      } else {
        console.log(chalk.green(`✅ Cleaned ${totalDeleted} old snapshots`));
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Failed to clean snapshots:'),
        error instanceof Error ? error.message : error,
      );
    }
  });
