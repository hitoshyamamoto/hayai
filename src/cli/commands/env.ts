import { Command } from 'commander';
import chalk from 'chalk';
import { getDockerManager } from '../../core/docker.js';
import { DatabaseInstance } from '../../core/types.js';
import { ExitCode, fail, failFromError, succeed } from '../cli-output.js';

type EnvFormat = 'shell' | 'dotenv' | 'airflow';

interface EnvCommandOptions {
  format: string;
  json?: boolean;
}

// KEY names must be valid POSIX environment variable identifiers.
function envName(instanceName: string): string {
  return instanceName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Airflow parses connections from AIRFLOW_CONN_* URIs where the scheme names
// the connection type. Only engines with a well-known Airflow connection type
// are emitted; the rest are skipped loudly rather than emitted with a scheme
// Airflow would reject at task runtime.
function airflowConnUri(instance: DatabaseInstance): string | null {
  const uri = instance.connection_uri;
  switch (instance.engine) {
    case 'postgresql':
    case 'timescaledb':
      return uri.replace(/^postgresql:/, 'postgres:');
    case 'mariadb':
      return uri; // already mysql://user:pass@host:port/db
    case 'redis':
      return uri; // redis://host:port
    default:
      return null;
  }
}

interface EnvEntry {
  name: string;
  value: string;
}

function buildEntries(
  instances: DatabaseInstance[],
  format: EnvFormat,
): { entries: EnvEntry[]; skipped: Array<{ name: string; engine: string }> } {
  const entries: EnvEntry[] = [];
  const skipped: Array<{ name: string; engine: string }> = [];

  for (const instance of instances) {
    if (format === 'airflow') {
      const uri = airflowConnUri(instance);
      if (uri === null) {
        skipped.push({ name: instance.name, engine: instance.engine });
        continue;
      }
      entries.push({ name: `AIRFLOW_CONN_${envName(instance.name)}`, value: uri });
    } else {
      entries.push({ name: `${envName(instance.name)}_DB_URL`, value: instance.connection_uri });
    }
  }

  return { entries, skipped };
}

export const envCommand = new Command('env')
  .description('Print connection environment variables for all instances')
  .option('--format <format>', 'Output format (shell, dotenv, airflow)', 'shell')
  .option('--json', 'Machine-readable JSON output on stdout')
  .addHelpText(
    'after',
    `
${chalk.bold('Formats:')}
  ${chalk.cyan('shell')}    export NAME_DB_URL='uri'      (eval "$(hayai env)")
  ${chalk.cyan('dotenv')}   NAME_DB_URL=uri               (hayai env --format dotenv >> .env)
  ${chalk.cyan('airflow')}  AIRFLOW_CONN_NAME=uri         (Airflow reads connections from env)

${chalk.bold('Airflow usage:')}
  ${chalk.cyan('# Load hayai instances as Airflow connections')}
  set -a; source <(hayai env --format airflow); set +a

  Engines without a well-known Airflow connection type are skipped and listed
  on stderr — nothing is emitted that Airflow would reject at task runtime.

${chalk.bold('Examples:')}
  eval "$(hayai env)"                      ${chalk.gray('# export all URIs into this shell')}
  hayai env --format dotenv >> .env        ${chalk.gray('# append to a dotenv file')}
  hayai env --format airflow --json        ${chalk.gray('# structured, for tooling')}
`,
  )
  .action(async (options: EnvCommandOptions) => {
    const jsonMode = Boolean(options.json);
    try {
      const format = options.format as EnvFormat;
      if (!['shell', 'dotenv', 'airflow'].includes(format)) {
        fail(
          'env',
          ExitCode.Usage,
          `Unknown format '${options.format}' (expected shell, dotenv or airflow)`,
          jsonMode,
        );
      }

      const dockerManager = getDockerManager();
      await dockerManager.initialize();
      const instances = dockerManager.getAllInstances();

      const { entries, skipped } = buildEntries(instances, format);

      if (jsonMode) {
        succeed(
          'env',
          {
            format,
            variables: Object.fromEntries(entries.map((entry) => [entry.name, entry.value])),
            skipped,
          },
          jsonMode,
        );
        return;
      }

      for (const entry of entries) {
        if (format === 'shell') {
          console.log(`export ${entry.name}=${shellQuote(entry.value)}`);
        } else {
          console.log(`${entry.name}=${entry.value}`);
        }
      }

      // stderr, so pipes and eval stay clean
      for (const skip of skipped) {
        console.error(
          chalk.yellow(
            `⚠️  Skipped '${skip.name}': no Airflow connection type for engine '${skip.engine}'`,
          ),
        );
      }
      if (entries.length === 0 && skipped.length === 0) {
        console.error(chalk.yellow('📦 No database instances found — run `hayai init` first'));
      }
    } catch (error) {
      failFromError('env', error, jsonMode);
    }
  });
