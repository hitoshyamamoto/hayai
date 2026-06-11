import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { getDockerManager } from '../../core/docker.js';
import { getTemplate } from '../../core/templates.js';
import { getPostgresExecCredentials, getMariaDBRootPassword } from '../../core/credentials.js';
import { SnapshotOptions } from '../../core/types.js';

async function createSnapshotDirectory(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function createSnapshot(
  instance: any,
  snapshotPath: string
): Promise<void> {
  const template = getTemplate(instance.engine);
  if (!template) {
    throw new Error(`Template not found for engine: ${instance.engine}`);
  }

  // Choose appropriate backup method based on database type
  switch (instance.engine) {
    case 'postgresql':
    case 'timescaledb':
      await createPostgreSQLSnapshot(instance.name, snapshotPath, instance.environment);
      break;
    case 'mariadb':
      await createMariaDBSnapshot(instance.name, snapshotPath, instance.environment);
      break;
    case 'redis':
      await createRedisSnapshot(instance.name, snapshotPath);
      break;
    case 'influxdb2':
    case 'influxdb3':
      await createInfluxDBSnapshot(instance.name, snapshotPath);
      break;
    case 'cassandra':
      await createCassandraSnapshot(instance.name, snapshotPath);
      break;
    default:
      await createGenericSnapshot(instance.name, snapshotPath);
  }
}

async function createPostgreSQLSnapshot(
  instanceName: string,
  snapshotPath: string,
  environment: Record<string, string> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { user, database } = getPostgresExecCredentials(environment);
    const dumpProcess = spawn('docker', [
      'exec', `${instanceName}-db`,
      'pg_dump', '-U', user, '-d', database, '--clean', '--create'
    ], { stdio: ['inherit', 'pipe', 'pipe'] });

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
  instanceName: string,
  snapshotPath: string,
  environment: Record<string, string> = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rootPassword = getMariaDBRootPassword(environment);
    const dumpProcess = spawn('docker', [
      'exec', '-e', `MYSQL_PWD=${rootPassword}`, `${instanceName}-db`,
      'mysqldump', '-u', 'root', '--all-databases'
    ], { stdio: ['inherit', 'pipe', 'pipe'] });

    const writeStream = createWriteStream(snapshotPath);
    dumpProcess.stdout.pipe(writeStream);

    dumpProcess.on('close', (code) => {
      writeStream.end();
      code === 0 ? resolve() : reject(new Error('MariaDB snapshot failed'));
    });

    dumpProcess.on('error', reject);
  });
}

async function createRedisSnapshot(instanceName: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create RDB backup
    const bgsaveProcess = spawn('docker', [
      'exec', `${instanceName}-db`, 'redis-cli', 'BGSAVE'
    ]);

    bgsaveProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Redis background save failed'));
        return;
      }

      // Wait for backup to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Copy RDB file
      const copyProcess = spawn('docker', [
        'cp', `${instanceName}-db:/data/dump.rdb`, snapshotPath
      ]);

      copyProcess.on('close', (copyCode) => {
        copyCode === 0 ? resolve() : reject(new Error('Failed to copy Redis snapshot'));
      });

      copyProcess.on('error', reject);
    });

    bgsaveProcess.on('error', reject);
  });
}

async function createInfluxDBSnapshot(instanceName: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const backupProcess = spawn('docker', [
      'exec', `${instanceName}-db`,
      'influx', 'backup', '/tmp/backup'
    ]);

    backupProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('InfluxDB backup failed'));
        return;
      }

      // Create tar archive
      const tarProcess = spawn('docker', [
        'exec', `${instanceName}-db`,
        'tar', '-czf', '/tmp/influx-backup.tar.gz', '/tmp/backup'
      ]);

      tarProcess.on('close', (tarCode) => {
        if (tarCode !== 0) {
          reject(new Error('Failed to create backup archive'));
          return;
        }

        // Copy to host
        const copyProcess = spawn('docker', [
          'cp', `${instanceName}-db:/tmp/influx-backup.tar.gz`, snapshotPath
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

async function createGenericSnapshot(instanceName: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const backupProcess = spawn('docker', [
      'exec', `${instanceName}-db`,
      'tar', '-czf', '/tmp/backup.tar.gz', '/data'
    ]);

    backupProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Generic backup failed'));
        return;
      }

      const copyProcess = spawn('docker', [
        'cp', `${instanceName}-db:/tmp/backup.tar.gz`, snapshotPath
      ]);

      copyProcess.on('close', (copyCode) => {
        copyCode === 0 ? resolve() : reject(new Error('Failed to copy generic snapshot'));
      });

      copyProcess.on('error', reject);
    });

    backupProcess.on('error', reject);
  });
}

async function createCassandraSnapshot(instanceName: string, snapshotPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const snapshotProcess = spawn('docker', [
      'exec', `${instanceName}-db`,
      'nodetool', 'snapshot'
    ]);

    snapshotProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Cassandra snapshot failed'));
        return;
      }

      const copyProcess = spawn('docker', [
        'exec', `${instanceName}-db`,
        'tar', '-czf', '/tmp/cassandra-snapshot.tar.gz', '/var/lib/cassandra/data'
      ]);

      copyProcess.on('close', (tarCode) => {
        if (tarCode !== 0) {
          reject(new Error('Failed to create Cassandra archive'));
          return;
        }

        const finalCopyProcess = spawn('docker', [
          'cp', `${instanceName}-db:/tmp/cassandra-snapshot.tar.gz`, snapshotPath
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

export const snapshotCommand = new Command('snapshot')
  .description('Create snapshots of database instances')
  .argument('<name>', 'Database instance name')
  .option('-o, --output <path>', 'Output directory for snapshots', './snapshots')
  .option('-c, --compress', 'Compress the snapshot')
  .option('--format <format>', 'Snapshot format (sql, rdb, tar)', 'sql')
  .action(async (name: string, options: SnapshotOptions) => {
    try {
      const dockerManager = getDockerManager();
      await dockerManager.initialize();

      const instance = dockerManager.getInstance(name);
      if (!instance) {
        console.error(chalk.red(`❌ Database instance '${name}' not found`));
        console.log(chalk.yellow('💡 Run `hayai list` to see available databases'));
        process.exit(1);
      }

      if (instance.status !== 'running') {
        console.error(chalk.red(`❌ Database '${name}' must be running to create snapshot`));
        console.log(chalk.yellow(`💡 Start it with: ${chalk.cyan(`hayai start ${name}`)}`));
        process.exit(1);
      }

      // Create snapshots directory
      await createSnapshotDirectory(options.output || './snapshots');

      // Generate snapshot filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotName = `${name}-snapshot-${timestamp}`;
      const outputDir = options.output || path.join(process.cwd(), 'snapshots');
      
      // Determine file extension based on database type and format
      let extension = 'sql';
      if (instance.engine === 'redis') extension = 'rdb';
      if (instance.engine.includes('influx') || instance.engine === 'cassandra') extension = 'tar.gz';
      if (options.format === 'tar') extension = 'tar.gz';
      
      const snapshotPath = path.join(outputDir, `${snapshotName}.${extension}`);

      console.log(chalk.cyan(`📸 Creating snapshot of '${name}'...`));
      console.log(chalk.gray(`Engine: ${instance.engine}`));
      console.log(chalk.gray(`Output: ${snapshotPath}`));

      const spinner = ora('Creating snapshot...').start();

      await createSnapshot(instance, snapshotPath);

      // Get file size
      const stats = await fs.stat(snapshotPath);
      const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      spinner.succeed(`Snapshot created successfully (${fileSizeMB} MB)`);

      console.log(chalk.green('\n✅ Snapshot completed!'));
      console.log(chalk.yellow('💡 Commands:'));
      console.log(`  • ${chalk.cyan('hayai snapshot list')} - View all snapshots`);

    } catch (error) {
      console.error(chalk.red('❌ Snapshot failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
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
      const snapshotFiles = files.filter(file => 
        file.includes('-snapshot-') && 
        (file.endsWith('.sql') || file.endsWith('.rdb') || file.endsWith('.tar.gz'))
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
          
          // Parse filename to extract info
          const parts = file.split('-snapshot-');
          const dbName = parts[0];
          const timestamp = parts[1]?.split('.')[0];
          const extension = path.extname(file);
          
          return {
            file,
            dbName,
            timestamp: timestamp ? new Date(timestamp.replace(/-/g, ':').replace(/T/, ' ')) : new Date(),
            size: sizeMB,
            extension
          };
        })
      );

      // Sort by timestamp (newest first)
      snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      snapshots.forEach(snapshot => {
        console.log(`📸 ${chalk.bold(snapshot.file)}`);
        console.log(`   Database: ${chalk.cyan(snapshot.dbName)}`);
        console.log(`   Created:  ${chalk.gray(snapshot.timestamp.toLocaleString())}`);
        console.log(`   Size:     ${chalk.yellow(snapshot.size)} MB`);
        console.log(`   Format:   ${chalk.magenta(snapshot.extension.substring(1))}`);
        console.log('');
      });

      console.log(chalk.yellow('💡 Commands:'));
      console.log(`  • ${chalk.cyan('hayai snapshot <name>')} - Create new snapshot`);
      console.log(`  • ${chalk.cyan('hayai snapshot clean')} - Remove old snapshots`);

    } catch (error) {
      console.error(chalk.red('❌ Failed to list snapshots:'), error instanceof Error ? error.message : error);
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
      const snapshotFiles = files.filter(file => 
        file.includes('-snapshot-') && 
        (file.endsWith('.sql') || file.endsWith('.rdb') || file.endsWith('.tar.gz'))
      );

      if (snapshotFiles.length === 0) {
        console.log(chalk.yellow('📁 No snapshots found to clean'));
        return;
      }

      // Group by database name
      const snapshotsByDb: Record<string, string[]> = {};
      
      snapshotFiles.forEach(file => {
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
          console.log(chalk.yellow(`🗑️  Cleaning ${dbName}: removing ${toDelete.length} old snapshots`));
          
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
      console.error(chalk.red('❌ Failed to clean snapshots:'), error instanceof Error ? error.message : error);
    }
  }); 