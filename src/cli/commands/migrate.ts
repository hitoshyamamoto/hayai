import { Command } from 'commander';
import chalk from 'chalk';
import { getDockerManager } from '../../core/docker.js';
import { CLIOptions } from '../../core/types.js';

interface MigrateOptions extends CLIOptions {
  from: string;
  to: string;
  targetEngine: string;
  dryRun?: boolean;
}

// Mapping of migration paths the planner understands. Execution is not
// implemented yet — see showManualMigrationGuidance below.
const MIGRATION_COMPATIBILITY: Record<string, string[]> = {
  // Time Series Migrations
  'influxdb2': ['influxdb3', 'victoriametrics', 'questdb'],
  'influxdb3': ['influxdb2', 'victoriametrics', 'questdb'],
  'timescaledb': ['influxdb2', 'influxdb3', 'questdb', 'victoriametrics'],
  'questdb': ['influxdb2', 'influxdb3', 'timescaledb', 'victoriametrics'],
  'victoriametrics': ['influxdb2', 'influxdb3', 'questdb'],
  'horaedb': ['influxdb2', 'influxdb3', 'questdb'],

  // SQL Database Migrations
  'postgresql': ['timescaledb'],
  'mariadb': ['postgresql'],

  // Vector Database Migrations
  'qdrant': ['milvus', 'weaviate'],
  'milvus': ['qdrant', 'weaviate'],
  'weaviate': ['qdrant', 'milvus'],

  // Search Engine Migrations
  'meilisearch': ['typesense'],
  'typesense': ['meilisearch'],

  // Graph Database Migrations
  'arangodb': ['nebula'],
  'nebula': ['arangodb'],

  // Key-Value Migrations
  'redis': ['leveldb', 'lmdb', 'tikv'],
  'leveldb': ['lmdb', 'redis', 'tikv'],
  'lmdb': ['leveldb', 'redis', 'tikv'],
  'tikv': ['redis', 'leveldb', 'lmdb'],

  // Wide Column Migrations
  'cassandra': ['arangodb'],
};

function validateMigrationCompatibility(sourceEngine: string, targetEngine: string): { compatible: boolean; reason?: string } {
  if (sourceEngine === targetEngine) {
    return {
      compatible: false,
      reason: 'Source and target engines are the same. Use clone command instead.'
    };
  }

  const compatibleTargets = MIGRATION_COMPATIBILITY[sourceEngine];
  if (!compatibleTargets || !compatibleTargets.includes(targetEngine)) {
    return {
      compatible: false,
      reason: `Migration from '${sourceEngine}' to '${targetEngine}' is not supported`
    };
  }

  return { compatible: true };
}

function getMigrationComplexity(sourceEngine: string, targetEngine: string): 'low' | 'medium' | 'high' {
  const key = `${sourceEngine}->${targetEngine}`;

  const complexityMap: Record<string, 'low' | 'medium' | 'high'> = {
    // Low complexity (same family/similar structure)
    'influxdb2->influxdb3': 'low',
    'influxdb3->influxdb2': 'low',
    'leveldb->lmdb': 'low',
    'lmdb->leveldb': 'low',

    // Medium complexity (similar purpose, different format)
    'meilisearch->typesense': 'medium',
    'typesense->meilisearch': 'medium',
    'qdrant->milvus': 'medium',
    'milvus->qdrant': 'medium',
    'redis->leveldb': 'medium',

    // High complexity (different paradigms)
    'timescaledb->influxdb2': 'high',
    'questdb->influxdb3': 'high',
    'postgresql->timescaledb': 'high',
    'cassandra->arangodb': 'high',
    'arangodb->nebula': 'high',
  };

  return complexityMap[key] || 'high';
}

function showMigrationWarnings(sourceEngine: string, targetEngine: string): void {
  const complexity = getMigrationComplexity(sourceEngine, targetEngine);

  console.log(chalk.yellow('\n⚠️  Migration Warnings:'));
  console.log(chalk.gray(`Migration Complexity: ${complexity.toUpperCase()}`));

  const warnings: Record<string, string[]> = {
    'timescaledb->influxdb2': [
      'TimescaleDB hypertables will be converted to InfluxDB measurements',
      'SQL relationships and constraints will be lost',
      'Time aggregation functions may need reconfiguration',
      'Custom PostgreSQL functions will not be migrated'
    ],
    'questdb->influxdb2': [
      'QuestDB table structures will be flattened',
      'SQL JOINs and complex queries will need rewriting',
      'Designated timestamp columns will be mapped to InfluxDB time field',
      'QuestDB-specific optimizations will be lost'
    ],
    'postgresql->timescaledb': [
      'Tables will need to be converted to hypertables manually',
      'Time-series specific optimizations must be configured',
      'Indexes may need recreation for time-series queries'
    ],
    'qdrant->milvus': [
      'Collection schemas may need adjustment',
      'Payload structures might change',
      'Vector indexing parameters will be reset',
      'Distance metrics compatibility should be verified'
    ],
    'milvus->qdrant': [
      'Entity schemas will be converted to Qdrant points',
      'Index types may not have direct equivalents',
      'Collection partitioning will be lost',
      'Metadata structures will change'
    ],
    'redis->leveldb': [
      'Redis data structures (hashes, sets, lists) will be serialized',
      'TTL/expiration data will be lost',
      'Redis-specific commands will not be available',
      'Performance characteristics will differ significantly'
    ],
    'cassandra->arangodb': [
      'Wide column model will be transformed to document model',
      'CQL queries will need complete rewriting to AQL',
      'Consistency models are fundamentally different',
      'Partitioning strategies will not transfer'
    ]
  };

  const key = `${sourceEngine}->${targetEngine}`;
  const specificWarnings = warnings[key];

  if (specificWarnings) {
    specificWarnings.forEach(warning => {
      console.log(chalk.gray(`  • ${warning}`));
    });
  } else {
    console.log(chalk.gray('  • Data format conversion may result in some information loss'));
    console.log(chalk.gray('  • Schema and indexing configurations will need manual review'));
    console.log(chalk.gray('  • Performance characteristics may differ between engines'));
  }
}

function showManualMigrationGuidance(sourceEngine: string, targetEngine: string): void {
  console.log(chalk.yellow('\n💡 How to migrate manually:'));

  const guidance: Record<string, string[]> = {
    'influxdb2': [
      'Export: docker exec <source>-db influx backup /tmp/backup',
      'Or stream line protocol with influx query and write it to the target'
    ],
    'influxdb3': [
      'Export: use the influxdb3 CLI or the /api/v3 query endpoints'
    ],
    'timescaledb': [
      'Export: docker exec <source>-db pg_dump -U <user> -d <db> > dump.sql',
      'Transform rows to the target format before importing'
    ],
    'postgresql': [
      'Export: docker exec <source>-db pg_dump -U <user> -d <db> > dump.sql',
      'Import into TimescaleDB, then convert tables with create_hypertable()'
    ],
    'mariadb': [
      'Export: docker exec <source>-db mysqldump -u root <db> > dump.sql',
      'Convert syntax with pgloader for a MariaDB → PostgreSQL move'
    ],
    'questdb': [
      'Export: SELECT ... INTO OUTFILE or the /exp REST endpoint (CSV)'
    ],
    'victoriametrics': [
      'Export: /api/v1/export (JSON lines) or vmctl for bulk moves'
    ],
    'qdrant': [
      'Use the snapshots API: POST /collections/<name>/snapshots'
    ],
    'milvus': [
      'Use the milvus-backup tool or collection export/import'
    ],
    'weaviate': [
      'Use the backup API or cursor-based object export'
    ],
    'meilisearch': [
      'Use the dumps API: POST /dumps, then import on the target'
    ],
    'typesense': [
      'Export collections with GET /collections/<name>/documents/export'
    ],
    'arangodb': [
      'Use arangodump + arangorestore, or arangoexport for graph data'
    ],
    'redis': [
      'Use redis-cli --rdb to dump, or MIGRATE for live key transfer'
    ],
    'cassandra': [
      'Use nodetool snapshot + sstableloader, or cqlsh COPY commands'
    ],
  };

  const sourceSteps = guidance[sourceEngine];
  if (sourceSteps) {
    sourceSteps.forEach(step => console.log(chalk.gray(`  • ${step}`)));
  } else {
    console.log(chalk.gray(`  • Check the ${sourceEngine} documentation for native export tools`));
  }
  console.log(chalk.gray(`  • Import the transformed data using ${targetEngine}'s native tooling`));
  console.log(chalk.gray('  • Create a snapshot first: ') + chalk.cyan('hayai snapshot <name>'));
}

async function handleMigrate(options: MigrateOptions): Promise<void> {
  if (!options.from || !options.to || !options.targetEngine) {
    console.error(chalk.red('❌ --from, --to, and --target-engine are required'));
    console.log(chalk.yellow('💡 Example: hayai migrate -f source-db -t target-db -e influxdb3 --dry-run'));
    process.exit(1);
  }

  const dockerManager = getDockerManager();
  await dockerManager.initialize();

  // Validate source database
  const sourceInstance = dockerManager.getInstance(options.from);
  if (!sourceInstance) {
    console.error(chalk.red(`❌ Source database '${options.from}' not found`));
    console.log(chalk.yellow('💡 Run `hayai list` to see available databases'));
    process.exit(1);
  }

  // Validate migration compatibility
  const compatibilityResult = validateMigrationCompatibility(sourceInstance.engine, options.targetEngine);
  if (!compatibilityResult.compatible) {
    console.error(chalk.red(`❌ Migration not supported: ${compatibilityResult.reason}`));
    console.log(chalk.yellow('\n💡 Supported migration paths:'));

    Object.entries(MIGRATION_COMPATIBILITY).forEach(([source, targets]) => {
      console.log(chalk.gray(`  ${chalk.cyan(source)} → ${targets.map(t => chalk.green(t)).join(', ')}`));
    });

    process.exit(1);
  }

  // Show migration plan
  console.log(chalk.cyan('\n🔍 Migration Plan:'));
  console.log(chalk.gray(`Source: ${options.from} (${chalk.cyan(sourceInstance.engine)})`));
  console.log(chalk.gray(`Target: ${options.to} (${chalk.cyan(options.targetEngine)})`));
  console.log(chalk.gray(`Complexity: ${chalk.magenta(getMigrationComplexity(sourceInstance.engine, options.targetEngine).toUpperCase())}`));

  showMigrationWarnings(sourceInstance.engine, options.targetEngine);

  if (options.dryRun) {
    console.log(chalk.yellow('\n🚧 Dry run — plan shown above, nothing executed'));
    return;
  }

  // Automated execution is not implemented. Say so instead of pretending.
  console.error(chalk.red('\n❌ Automated migration execution is not implemented yet'));
  console.log(chalk.gray('This command currently validates compatibility and plans the migration.'));
  showManualMigrationGuidance(sourceInstance.engine, options.targetEngine);
  process.exit(1);
}

export const migrateCommand = new Command('migrate')
  .description('Plan a migration between compatible database engines')
  .option('-f, --from <name>', 'Source database name')
  .option('-t, --to <name>', 'Target database name')
  .option('-e, --target-engine <engine>', 'Target database engine')
  .option('--dry-run', 'Show the migration plan')
  .option('--verbose', 'Enable verbose output')
  .addHelpText('after', `
${chalk.bold('Status:')}
  ${chalk.yellow('⚠️  Automated execution is not implemented yet.')}
  This command validates compatibility, shows the plan and risks, and
  points to the native tooling for performing the migration manually.

${chalk.bold('Planned Migration Paths:')}

${chalk.cyan('Time Series:')}    influxdb2 ↔ influxdb3 ↔ victoriametrics ↔ questdb,
                 timescaledb/horaedb → influxdb2/3, questdb
${chalk.cyan('SQL:')}            postgresql → timescaledb, mariadb → postgresql
${chalk.cyan('Vector:')}         qdrant ↔ milvus ↔ weaviate
${chalk.cyan('Graph:')}          arangodb ↔ nebula
${chalk.cyan('Search:')}         meilisearch ↔ typesense
${chalk.cyan('Key-Value:')}      redis ↔ leveldb ↔ lmdb ↔ tikv
${chalk.cyan('Wide Column:')}    cassandra → arangodb

${chalk.bold('Examples:')}
  ${chalk.cyan('# Check whether a migration path is supported and see the plan')}
  hayai migrate -f influx2-prod -t influx3-prod -e influxdb3 --dry-run

  ${chalk.cyan('# Same, with manual migration guidance for the engines involved')}
  hayai migrate -f timescale-metrics -t influx-metrics -e influxdb2

${chalk.bold('Migration Complexity:')}
  ${chalk.green('🟢 LOW:')}     Same family engines (influxdb2 → influxdb3)
  ${chalk.yellow('🟡 MEDIUM:')}  Similar purpose (qdrant → milvus)
  ${chalk.red('🔴 HIGH:')}     Different paradigms (timescaledb → influxdb2)
`)
  .action(handleMigrate);
