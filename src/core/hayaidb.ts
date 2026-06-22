import { readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { HayaiDbConfig, DatabaseSpec } from './types.js';
import { getDockerManager } from './docker.js';
import { DatabaseTemplates } from './templates.js';

export class HayaiDbManager {
  private static readonly CONFIG_FILE = '.hayaidb';

  public static async exportConfig(outputPath?: string): Promise<string> {
    const dockerManager = getDockerManager();
    await dockerManager.initialize();

    const instances = dockerManager.getAllInstances();
    const configPath = outputPath || HayaiDbManager.CONFIG_FILE;

    const config: HayaiDbConfig = {
      version: '1.0',
      project: path.basename(process.cwd()),
      databases: {},
    };

    // Convert existing instances to database specs
    for (const instance of instances) {
      const spec: DatabaseSpec = {
        engine: instance.engine,
        environment: instance.environment,
      };

      // Add port only if it's allocated (not embedded databases)
      if (instance.port > 0) {
        spec.port = instance.port;
      }

      config.databases[instance.name] = spec;
    }

    // Generate YAML content
    const yamlContent = yaml.stringify(config, {
      indent: 2,
      lineWidth: 80,
      minContentWidth: 20,
    });

    // Write to file
    await writeFile(configPath, yamlContent, 'utf-8');

    return configPath;
  }

  public static async syncConfig(configPath?: string): Promise<{
    created: string[];
    skipped: string[];
    errors: { name: string; error: string }[];
  }> {
    const filePath = configPath || HayaiDbManager.CONFIG_FILE;

    // Check if file exists
    if (!(await HayaiDbManager.fileExists(filePath))) {
      throw new Error(`Configuration file '${filePath}' not found`);
    }

    // Read and parse config
    const content = await readFile(filePath, 'utf-8');
    const config = yaml.parse(content) as HayaiDbConfig;

    // Validate config
    HayaiDbManager.validateConfig(config);

    const dockerManager = getDockerManager();
    await dockerManager.initialize();

    const existingInstances = dockerManager.getAllInstances();
    const existingNames = new Set(existingInstances.map((i) => i.name));

    const result = {
      created: [] as string[],
      skipped: [] as string[],
      errors: [] as { name: string; error: string }[],
    };

    // Process each database in config
    for (const [name, spec] of Object.entries(config.databases)) {
      try {
        // Skip if already exists
        if (existingNames.has(name)) {
          result.skipped.push(name);
          continue;
        }

        // Get template for the engine
        const template = DatabaseTemplates.getTemplate(spec.engine);
        if (!template) {
          result.errors.push({
            name,
            error: `Unknown engine: ${spec.engine}`,
          });
          continue;
        }

        // Create database instance
        await dockerManager.createDatabase(name, template, {
          port: spec.port,
          adminDashboard: spec.admin_dashboard,
          customEnv: spec.environment,
        });

        result.created.push(name);
      } catch (error) {
        result.errors.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  public static async validateConfig(config: HayaiDbConfig): Promise<void> {
    if (!config.version) {
      throw new Error('Missing required field: version');
    }

    if (!config.databases || typeof config.databases !== 'object') {
      throw new Error('Missing or invalid field: databases');
    }

    // Validate each database spec
    for (const [name, spec] of Object.entries(config.databases)) {
      if (!spec.engine) {
        throw new Error(`Database '${name}': missing required field 'engine'`);
      }

      // Check if engine is supported
      const template = DatabaseTemplates.getTemplate(spec.engine);
      if (!template) {
        throw new Error(`Database '${name}': unsupported engine '${spec.engine}'`);
      }

      // Validate port if specified
      if (spec.port !== undefined) {
        if (typeof spec.port !== 'number' || spec.port < 1 || spec.port > 65535) {
          throw new Error(`Database '${name}': invalid port ${spec.port}`);
        }
      }
    }
  }

  public static async configExists(configPath?: string): Promise<boolean> {
    const filePath = configPath || HayaiDbManager.CONFIG_FILE;
    return await HayaiDbManager.fileExists(filePath);
  }

  public static async loadConfig(configPath?: string): Promise<HayaiDbConfig> {
    const filePath = configPath || HayaiDbManager.CONFIG_FILE;

    if (!(await HayaiDbManager.fileExists(filePath))) {
      throw new Error(`Configuration file '${filePath}' not found`);
    }

    const content = await readFile(filePath, 'utf-8');
    const config = yaml.parse(content) as HayaiDbConfig;

    await HayaiDbManager.validateConfig(config);

    return config;
  }

  private static async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public static generateSampleConfig(): HayaiDbConfig {
    return {
      version: '1.0',
      project: 'my-awesome-app',
      databases: {
        main_postgres: {
          engine: 'postgresql',
          port: 5432,
          environment: {
            POSTGRES_USER: 'myapp_user',
            POSTGRES_PASSWORD: 'secure_password_123',
            POSTGRES_DB: 'myapp_production',
          },
        },
        redis_cache: {
          engine: 'redis',
          port: 6379,
          environment: {
            REDIS_PASSWORD: 'redis_secret_456',
          },
        },
        metrics_influx: {
          engine: 'influxdb2',
          port: 8086,
          environment: {
            DOCKER_INFLUXDB_INIT_USERNAME: 'analytics_admin',
            DOCKER_INFLUXDB_INIT_PASSWORD: 'influx_pass_789',
            DOCKER_INFLUXDB_INIT_ORG: 'mycompany',
            DOCKER_INFLUXDB_INIT_BUCKET: 'app_metrics',
          },
        },
        dev_sqlite: {
          engine: 'sqlite',
        },
      },
      profiles: {
        development: ['main_postgres', 'redis_cache', 'dev_sqlite'],
        production: ['main_postgres', 'redis_cache', 'metrics_influx'],
      },
    };
  }
}
