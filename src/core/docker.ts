import { readFile, writeFile, access, mkdir, rm } from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { DatabaseInstance, DatabaseTemplate, ComposeFile } from './types.js';
import { getConfig, getComposeFilePath, getDataDirectory } from './config.js';
import { getTemplate } from './templates.js';
import { allocatePort, deallocatePort } from './port-manager.js';
import { withStateLock } from './lock.js';

interface DockerVerificationResult {
  isInstalled: boolean;
  isRunning: boolean;
  composeAvailable?: boolean;
  version?: string;
  error?: string;
}

// Thrown instead of exiting so commands can map it to the documented
// Environment exit code (and emit a JSON envelope in --json mode).
export class DockerNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DockerNotReadyError';
  }
}

export class DockerManager {
  private static instance: DockerManager;
  private instances: Map<string, DatabaseInstance> = new Map();
  private composeFile: ComposeFile | null = null;
  private dockerVerified: boolean = false;

  private constructor() {}

  public static getInstance(): DockerManager {
    if (!DockerManager.instance) {
      DockerManager.instance = new DockerManager();
    }
    return DockerManager.instance;
  }

  private async checkDockerInstallation(): Promise<DockerVerificationResult> {
    return new Promise((resolve) => {
      // First check if docker command exists
      const child = spawn('docker', ['--version'], { stdio: 'pipe' });

      let stdout = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          resolve({
            isInstalled: false,
            isRunning: false,
            error: 'Docker command not found',
          });
          return;
        }

        // Docker is installed, now check if daemon is running
        const versionMatch = stdout.match(/Docker version (\d+\.\d+\.\d+)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';

        // Check if Docker daemon is running
        const pingChild = spawn('docker', ['info'], { stdio: 'pipe' });

        pingChild.on('close', (pingCode) => {
          if (pingCode !== 0) {
            resolve({
              isInstalled: true,
              isRunning: false,
              version,
              error: 'Docker daemon not running',
            });
            return;
          }

          // Daemon is up — verify the Compose V2 plugin is available
          const composeChild = spawn('docker', ['compose', 'version'], { stdio: 'pipe' });

          composeChild.on('close', (composeCode) => {
            resolve({
              isInstalled: true,
              isRunning: true,
              composeAvailable: composeCode === 0,
              version,
              error: composeCode !== 0 ? 'Docker Compose V2 plugin not found' : undefined,
            });
          });

          composeChild.on('error', () => {
            resolve({
              isInstalled: true,
              isRunning: true,
              composeAvailable: false,
              version,
              error: 'Docker Compose V2 plugin not found',
            });
          });
        });

        pingChild.on('error', () => {
          resolve({
            isInstalled: true,
            isRunning: false,
            error: 'Docker daemon not accessible',
          });
        });
      });

      child.on('error', () => {
        resolve({
          isInstalled: false,
          isRunning: false,
          error: 'Docker command not found',
        });
      });
    });
  }

  private showDockerInstallationInstructions(result: DockerVerificationResult): void {
    console.error(chalk.red('\n❌ Docker Setup Required\n'));

    if (!result.isInstalled) {
      console.error(chalk.yellow('🐳 Docker is not installed on your system.'));
      console.error(chalk.gray('Hayai requires Docker to manage database containers.\n'));

      console.error(chalk.bold('📦 Installation Instructions:\n'));

      const platform = process.platform;

      switch (platform) {
        case 'darwin': // macOS
          console.error(chalk.cyan('macOS:'));
          console.error(
            '  • Download Docker Desktop: https://docs.docker.com/desktop/install/mac-install/',
          );
          console.error('  • Or install via Homebrew: brew install --cask docker');
          break;

        case 'win32': // Windows
          console.error(chalk.cyan('Windows:'));
          console.error(
            '  • Download Docker Desktop: https://docs.docker.com/desktop/install/windows-install/',
          );
          console.error('  • Or install via Chocolatey: choco install docker-desktop');
          console.error('  • Or install via Winget: winget install Docker.DockerDesktop');
          break;

        default: // Linux
          console.error(chalk.cyan('Linux:'));
          console.error('  • Ubuntu/Debian: curl -fsSL https://get.docker.com | sh');
          console.error('  • Fedora: sudo dnf install docker-ce docker-ce-cli containerd.io');
          console.error('  • Arch: sudo pacman -S docker docker-compose');
          console.error(
            '  • Or use Docker Desktop: https://docs.docker.com/desktop/install/linux-install/',
          );
          break;
      }
    } else if (result.isRunning && result.composeAvailable === false) {
      console.error(chalk.yellow('🐳 Docker is running but the Compose V2 plugin is missing.'));
      console.error(chalk.gray(`Version: ${result.version}\n`));

      console.error(chalk.bold('📦 Install Docker Compose V2:\n'));
      console.error(
        chalk.cyan('  • Docker Desktop: update to a recent version (Compose V2 is included)'),
      );
      console.error(chalk.cyan('  • Debian/Ubuntu: sudo apt-get install docker-compose-plugin'));
      console.error(chalk.cyan('  • Other platforms: https://docs.docker.com/compose/install/'));
    } else if (!result.isRunning) {
      console.error(chalk.yellow('🐳 Docker is installed but not running.'));
      console.error(chalk.gray(`Version: ${result.version}\n`));

      console.error(chalk.bold('🚀 Start Docker:\n'));

      const platform = process.platform;

      switch (platform) {
        case 'darwin': // macOS
        case 'win32': // Windows
          console.error(chalk.cyan('• Start Docker Desktop application'));
          console.error(chalk.cyan('• Wait for Docker to fully initialize'));
          break;

        default: // Linux
          console.error(chalk.cyan('• sudo systemctl start docker'));
          console.error(chalk.cyan('• sudo systemctl enable docker  # Enable auto-start'));
          console.error(chalk.cyan('• Or start Docker Desktop if installed'));
          break;
      }
    }

    console.error(
      chalk.yellow('\n💡 After installing/starting Docker, try running your command again.'),
    );
    console.error(chalk.gray('🔍 Verify Docker: docker --version && docker info\n'));
  }

  // Verified lazily, only on the first operation that actually talks to the
  // daemon. Embedded engines and read-only commands (list, connect, init)
  // work without Docker at all.
  public async ensureDockerReady(): Promise<void> {
    if (this.dockerVerified) {
      return; // Already verified in this session
    }

    const result = await this.checkDockerInstallation();

    if (!result.isInstalled || !result.isRunning || !result.composeAvailable) {
      this.showDockerInstallationInstructions(result);
      throw new DockerNotReadyError(result.error || 'Docker is not available');
    }

    // Docker is ready
    this.dockerVerified = true;

    // Status chatter goes to stderr so data commands (list --format json,
    // connect --uri) keep stdout machine-readable.
    console.error(chalk.green(`✅ Docker ${result.version} is ready`));
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async initialize(): Promise<void> {
    await this.loadExistingInstances();
    await this.loadComposeFile();
  }

  // All read-modify-write cycles over the local state go through here:
  // reloading inside the lock is what makes concurrent hayai processes safe —
  // without it, a stale in-memory map would overwrite the other process's
  // changes on save.
  private async mutateState<T>(fn: () => Promise<T>): Promise<T> {
    return withStateLock(async () => {
      await this.loadExistingInstances();
      return await fn();
    });
  }

  public async createDatabase(
    name: string,
    template: DatabaseTemplate,
    options: {
      port?: number;
      adminDashboard?: boolean;
      customEnv?: Record<string, string>;
    } = {},
  ): Promise<DatabaseInstance> {
    return this.mutateState(async () => {
      // Validate name against the just-reloaded state, not a stale snapshot
      if (this.instances.has(name)) {
        throw new Error(`Database instance '${name}' already exists`);
      }

      // Embedded engines are plain files on the host — no container, no port
      const isEmbedded = template.engine.ports.length === 0;

      let port = 0;
      if (!isEmbedded && this.getDefaultPortForEngine(template.engine.name) > 0) {
        port = await allocatePort(name, options.port);
      }

      // Create data directory
      const dataDir = await getDataDirectory();
      const instanceDataDir = path.join(dataDir, name);
      await mkdir(instanceDataDir, { recursive: true });

      // Create database instance
      const instance: DatabaseInstance = {
        name,
        engine: template.engine.name,
        port,
        volume: instanceDataDir,
        environment: {
          ...template.engine.environment,
          ...options.customEnv,
        },
        status: isEmbedded ? 'embedded' : 'stopped',
        created_at: new Date().toISOString(),
        connection_uri: this.generateConnectionUri(template, port, name, instanceDataDir),
      };

      // Add to instances
      this.instances.set(name, instance);

      // Update compose file
      await this.updateComposeFile();

      // Save instances
      await this.saveInstances();

      return instance;
    });
  }

  public async removeDatabase(name: string, options: { keepData?: boolean } = {}): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Database instance '${name}' not found`);
    }

    // Container teardown happens outside the state lock: a graceful stop can
    // take many seconds and must not block concurrent hayai processes.
    if (instance.status !== 'embedded') {
      const serviceName = `${name}-db`;

      try {
        // Stop and remove container
        await this.executeDockerCompose(['stop', serviceName]);
        await this.executeDockerCompose(['rm', '-f', serviceName]);
      } catch (error) {
        console.warn(`Failed to stop/remove container for '${name}':`, error);
      }
    }

    await this.mutateState(async () => {
      // Deallocate port if it was allocated
      if (instance.port > 0) {
        await deallocatePort(instance.port);
      }

      // Remove from instances
      this.instances.delete(name);

      // Clean up data directory unless the caller asked to keep it
      if (!options.keepData && (await this.pathExists(instance.volume))) {
        await rm(instance.volume, { recursive: true });
      }

      // Update compose file and save instances
      await this.updateComposeFile();
      await this.saveInstances();
    });
  }

  public async startDatabase(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Database instance '${name}' not found`);
    }

    if (instance.status === 'embedded') {
      console.log(
        chalk.gray(
          `ℹ️  '${name}' is an embedded database — nothing to start. Data: ${instance.volume}`,
        ),
      );
      return;
    }

    // Regenerate the compose file from fresh state so a concurrent process's
    // instances aren't dropped from it.
    await this.mutateState(() => this.updateComposeFile());

    const serviceName = `${name}-db`;

    try {
      // The compose call (which may pull images for minutes) runs outside the
      // state lock; only the status write is serialized.
      await this.executeDockerCompose(['up', '-d', serviceName]);
      await this.setInstanceStatus(name, 'running');
    } catch (error) {
      await this.setInstanceStatus(name, 'error');
      if (error instanceof DockerNotReadyError) {
        throw error; // keep the Environment classification for the CLI layer
      }
      throw new Error(`Failed to start database '${name}': ${error}`);
    }
  }

  private async setInstanceStatus(name: string, status: DatabaseInstance['status']): Promise<void> {
    await this.mutateState(async () => {
      const current = this.instances.get(name);
      if (!current || current.status === 'embedded') {
        return;
      }
      current.status = status;
      this.instances.set(name, current);
      await this.saveInstances();
    });
  }

  public async stopDatabase(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Database instance '${name}' not found`);
    }

    if (instance.status === 'embedded') {
      console.log(chalk.gray(`ℹ️  '${name}' is an embedded database — nothing to stop.`));
      return;
    }

    // Ensure compose file exists, regenerated from fresh state
    await this.mutateState(() => this.updateComposeFile());

    const serviceName = `${name}-db`;

    try {
      await this.executeDockerCompose(['stop', serviceName]);
      await this.setInstanceStatus(name, 'stopped');
    } catch (error) {
      await this.setInstanceStatus(name, 'error');
      if (error instanceof DockerNotReadyError) {
        throw error; // keep the Environment classification for the CLI layer
      }
      throw new Error(`Failed to stop database '${name}': ${error}`);
    }
  }

  private async executeDockerCompose(args: string[]): Promise<string> {
    await this.ensureDockerReady();
    const composeFilePath = await getComposeFilePath();

    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['compose', '-f', composeFilePath, ...args], {
        stdio: ['inherit', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Docker compose failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async setAllInstanceStatuses(status: DatabaseInstance['status']): Promise<void> {
    await this.mutateState(async () => {
      for (const [name, instance] of this.instances) {
        if (instance.status === 'embedded') continue;
        instance.status = status;
        this.instances.set(name, instance);
      }
      await this.saveInstances();
    });
  }

  public async startAllDatabases(): Promise<void> {
    // Regenerate the compose file from fresh state before touching Docker
    await this.mutateState(() => this.updateComposeFile());
    try {
      await this.executeDockerCompose(['up', '-d']);
      await this.setAllInstanceStatuses('running');
    } catch (error) {
      await this.setAllInstanceStatuses('error');
      if (error instanceof DockerNotReadyError) {
        throw error;
      }
      throw new Error(`Failed to start databases: ${error}`);
    }
  }

  public async stopAllDatabases(): Promise<void> {
    await this.mutateState(() => this.updateComposeFile());
    try {
      await this.executeDockerCompose(['stop']);
      await this.setAllInstanceStatuses('stopped');
    } catch (error) {
      await this.setAllInstanceStatuses('error');
      if (error instanceof DockerNotReadyError) {
        throw error;
      }
      throw new Error(`Failed to stop databases: ${error}`);
    }
  }

  public getInstance(name: string): DatabaseInstance | undefined {
    return this.instances.get(name);
  }

  public getAllInstances(): DatabaseInstance[] {
    return Array.from(this.instances.values());
  }

  public getRunningInstances(): DatabaseInstance[] {
    return this.getAllInstances().filter((instance) => instance.status === 'running');
  }

  public getStoppedInstances(): DatabaseInstance[] {
    return this.getAllInstances().filter((instance) => instance.status === 'stopped');
  }

  private async updateComposeFile(): Promise<void> {
    const config = await getConfig();
    const composeFilePath = await getComposeFilePath();

    this.composeFile = {
      version: '3.8',
      services: {},
      volumes: {},
      networks: {
        [config.docker.network_name]: {
          driver: 'bridge',
        },
      },
    };

    // Add services for each database instance
    for (const [name, instance] of this.instances) {
      if (instance.status === 'embedded') {
        continue; // embedded engines are host files, not containers
      }
      const serviceName = `${name}-db`;
      const engine = this.getEngineDefinition(instance.engine);
      const defaultPort = engine.ports[0] ?? 0;

      const serviceConfig: any = {
        image: engine.image,
        volumes: [`${instance.volume}:${engine.volumes[0] ?? '/data'}`],
        environment: instance.environment,
        restart: config.defaults.restart_policy,
        // Services join the configured network explicitly — previously the
        // networks block was declared but never referenced, so every service
        // silently landed on the compose default network instead.
        networks: [config.docker.network_name],
      };

      const healthcheck = this.resolveHealthcheck(engine, instance.environment);
      if (healthcheck) {
        serviceConfig.healthcheck = healthcheck;
      }

      // Only add ports for databases that need them (not embedded databases)
      if (defaultPort > 0) {
        serviceConfig.ports = [`${instance.port}:${defaultPort}`];
      }

      this.composeFile.services[serviceName] = serviceConfig;

      // Add volume
      this.composeFile.volumes[`${name}-data`] = {
        driver: config.defaults.volume_driver,
      };
    }

    // Write compose file
    const yamlContent = yaml.stringify(this.composeFile, {
      indent: 2,
      lineWidth: 120,
      minContentWidth: 20,
    });

    await writeFile(composeFilePath, yamlContent, 'utf-8');
  }

  private async loadExistingInstances(): Promise<void> {
    const dataDir = await getDataDirectory();
    const instancesFile = path.join(dataDir, 'instances.json');

    this.instances.clear();

    if (await this.pathExists(instancesFile)) {
      try {
        const content = await readFile(instancesFile, 'utf-8');
        const instancesData = JSON.parse(content);

        for (const [name, instanceData] of Object.entries(instancesData)) {
          this.instances.set(name, instanceData as DatabaseInstance);
        }
      } catch (error) {
        console.warn('Failed to load existing instances:', error);
      }
    }
  }

  private async saveInstances(): Promise<void> {
    const dataDir = await getDataDirectory();
    const instancesFile = path.join(dataDir, 'instances.json');

    const instancesData: Record<string, DatabaseInstance> = {};
    for (const [name, instance] of this.instances) {
      instancesData[name] = instance;
    }

    try {
      await writeFile(instancesFile, JSON.stringify(instancesData, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Failed to save instances:', error);
    }
  }

  private async loadComposeFile(): Promise<void> {
    const composeFilePath = await getComposeFilePath();

    if (await this.pathExists(composeFilePath)) {
      try {
        const content = await readFile(composeFilePath, 'utf-8');
        this.composeFile = yaml.parse(content) as ComposeFile;
      } catch (error) {
        console.warn('Failed to load existing compose file:', error);
        this.composeFile = null;
      }
    }
  }

  private generateConnectionUri(
    template: DatabaseTemplate,
    port: number,
    dbName: string,
    volumePath: string,
  ): string {
    const engine = template.engine;
    const env = engine.environment;

    switch (engine.name) {
      case 'postgresql':
        return `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@localhost:${port}/${env.POSTGRES_DB}`;

      case 'mariadb':
        return `mysql://${env.MYSQL_USER}:${env.MYSQL_PASSWORD}@localhost:${port}/${env.MYSQL_DATABASE}`;

      case 'redis':
        // Unauthenticated by design — the image ignores REDIS_PASSWORD, so a
        // credentialed URI here would just be a false promise.
        return `redis://localhost:${port}`;

      case 'cassandra':
        return `cassandra://localhost:${port}`;

      case 'qdrant':
        return `http://localhost:${port}`;

      case 'weaviate':
        return `http://localhost:${port}`;

      case 'milvus':
        return `http://localhost:${port}`;

      case 'arangodb':
        return `http://localhost:${port}`;

      case 'meilisearch':
        return `http://localhost:${port}`;

      case 'typesense':
        return `http://localhost:${port}`;

      case 'sqlite':
        return `sqlite://${path.join(volumePath, `${dbName}.db`)}`;

      case 'duckdb':
        return `duckdb://${path.join(volumePath, `${dbName}.duckdb`)}`;

      case 'leveldb':
        return `leveldb://${volumePath}`;

      case 'lmdb':
        return `lmdb://${volumePath}`;

      // Time Series Databases
      case 'influxdb3':
        return `http://localhost:${port}`;

      case 'influxdb2':
        return `http://localhost:${port}`;

      case 'timescaledb':
        return `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@localhost:${port}/${env.POSTGRES_DB}`;

      case 'questdb':
        return `postgresql://admin:quest@localhost:8812/qdb`;

      case 'victoriametrics':
        return `http://localhost:${port}`;

      case 'horaedb':
        return `http://localhost:${port}`;

      default:
        return `http://localhost:${port}`;
    }
  }

  // templates.ts is the single source of truth for engine definitions. The
  // per-engine maps that used to live here had already drifted from it: tikv
  // and nebula fell through to the alpine/8080 fallbacks and produced broken
  // compose services.
  private getEngineDefinition(engineName: string) {
    const template = getTemplate(engineName);
    if (!template) {
      throw new Error(
        `No template found for engine '${engineName}' — the instance predates or ` +
          'outlives the supported engine list',
      );
    }
    return template.engine;
  }

  private getDefaultPortForEngine(engineName: string): number {
    return this.getEngineDefinition(engineName).ports[0] ?? 0;
  }

  // Template healthchecks may reference instance variables (e.g.
  // pg_isready -U ${POSTGRES_USER}). Compose would substitute those from the
  // HOST environment (usually to nothing), so they are resolved here against
  // the instance's own environment before the file is written.
  private resolveHealthcheck(
    engine: { healthcheck?: { test: string; interval: string; timeout: string; retries: number } },
    environment: Record<string, string>,
  ): { test: string; interval: string; timeout: string; retries: number } | undefined {
    if (!engine.healthcheck) {
      return undefined;
    }
    const test = engine.healthcheck.test.replace(
      /\$\{(\w+)\}/g,
      (_match, variable) => environment[variable] ?? '',
    );
    return { ...engine.healthcheck, test };
  }

  public async getComposeFileContent(): Promise<string> {
    if (!this.composeFile) {
      await this.updateComposeFile();
    }

    return yaml.stringify(this.composeFile, {
      indent: 2,
      lineWidth: 120,
      minContentWidth: 20,
    });
  }

  public async updateEnvironmentFile(envFilePath: string = '.env'): Promise<void> {
    const envPath = path.resolve(envFilePath);
    let envContent = '';

    // Load existing .env file if it exists
    if (await this.pathExists(envPath)) {
      envContent = await readFile(envPath, 'utf-8');
    }

    // Add connection URIs for each database
    const envLines = envContent.split('\n');
    const updatedLines: string[] = [];
    const addedVars = new Set<string>();

    for (const line of envLines) {
      if (line.trim() && !line.startsWith('#')) {
        const [key] = line.split('=');
        if (key && !key.toUpperCase().endsWith('_DB_URL')) {
          updatedLines.push(line);
        }
      } else {
        updatedLines.push(line);
      }
    }

    // Add database connection URIs
    updatedLines.push('');
    updatedLines.push('# Database connections generated by Hayai');

    for (const [name, instance] of this.instances) {
      const varName = `${name.toUpperCase()}_DB_URL`;
      if (!addedVars.has(varName)) {
        updatedLines.push(`${varName}=${instance.connection_uri}`);
        addedVars.add(varName);
      }
    }

    await writeFile(envPath, updatedLines.join('\n'), 'utf-8');
  }
}

// Convenience functions for global access
export const getDockerManager = (): DockerManager => {
  return DockerManager.getInstance();
};

export const createDatabase = async (
  name: string,
  template: DatabaseTemplate,
  options: {
    port?: number;
    adminDashboard?: boolean;
    customEnv?: Record<string, string>;
  } = {},
): Promise<DatabaseInstance> => {
  const manager = DockerManager.getInstance();
  await manager.initialize();
  return await manager.createDatabase(name, template, options);
};

export const removeDatabase = async (
  name: string,
  options: { keepData?: boolean } = {},
): Promise<void> => {
  const manager = DockerManager.getInstance();
  await manager.initialize();
  await manager.removeDatabase(name, options);
};

export const startDatabase = async (name: string): Promise<void> => {
  const manager = DockerManager.getInstance();
  await manager.initialize();
  await manager.startDatabase(name);
};

export const stopDatabase = async (name: string): Promise<void> => {
  const manager = DockerManager.getInstance();
  await manager.initialize();
  await manager.stopDatabase(name);
};

export const getAllDatabases = async (): Promise<DatabaseInstance[]> => {
  const manager = DockerManager.getInstance();
  await manager.initialize();
  return manager.getAllInstances();
};

export async function executeDockerCommand(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn('docker', args);

    let stdout = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      data.toString();
    });

    process.on('close', (code) => {
      code === 0 ? resolve(stdout) : reject(new Error(`Docker command failed with code ${code}`));
    });
  });
}
