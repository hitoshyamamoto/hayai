import { readFile, writeFile, access, mkdir, rm } from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { DatabaseInstance, DatabaseTemplate, ComposeFile } from './types.js';
import { getConfig, getComposeFilePath, getDataDirectory } from './config.js';
import { allocatePort, deallocatePort } from './port-manager.js';

interface DockerVerificationResult {
  isInstalled: boolean;
  isRunning: boolean;
  composeAvailable?: boolean;
  version?: string;
  error?: string;
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
            error: 'Docker command not found'
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
              error: 'Docker daemon not running'
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
              error: composeCode !== 0 ? 'Docker Compose V2 plugin not found' : undefined
            });
          });

          composeChild.on('error', () => {
            resolve({
              isInstalled: true,
              isRunning: true,
              composeAvailable: false,
              version,
              error: 'Docker Compose V2 plugin not found'
            });
          });
        });

        pingChild.on('error', () => {
          resolve({
            isInstalled: true,
            isRunning: false,
            error: 'Docker daemon not accessible'
          });
        });
      });
      
      child.on('error', () => {
        resolve({
          isInstalled: false,
          isRunning: false,
          error: 'Docker command not found'
        });
      });
    });
  }

  private showDockerInstallationInstructions(result: DockerVerificationResult): void {
    console.log(chalk.red('\n❌ Docker Setup Required\n'));
    
    if (!result.isInstalled) {
      console.log(chalk.yellow('🐳 Docker is not installed on your system.'));
      console.log(chalk.gray('Hayai requires Docker to manage database containers.\n'));
      
      console.log(chalk.bold('📦 Installation Instructions:\n'));
      
      const platform = process.platform;
      
      switch (platform) {
        case 'darwin': // macOS
          console.log(chalk.cyan('macOS:'));
          console.log('  • Download Docker Desktop: https://docs.docker.com/desktop/install/mac-install/');
          console.log('  • Or install via Homebrew: brew install --cask docker');
          break;
          
        case 'win32': // Windows
          console.log(chalk.cyan('Windows:'));
          console.log('  • Download Docker Desktop: https://docs.docker.com/desktop/install/windows-install/');
          console.log('  • Or install via Chocolatey: choco install docker-desktop');
          console.log('  • Or install via Winget: winget install Docker.DockerDesktop');
          break;
          
        default: // Linux
          console.log(chalk.cyan('Linux:'));
          console.log('  • Ubuntu/Debian: curl -fsSL https://get.docker.com | sh');
          console.log('  • Fedora: sudo dnf install docker-ce docker-ce-cli containerd.io');
          console.log('  • Arch: sudo pacman -S docker docker-compose');
          console.log('  • Or use Docker Desktop: https://docs.docker.com/desktop/install/linux-install/');
          break;
      }
      
    } else if (result.isRunning && result.composeAvailable === false) {
      console.log(chalk.yellow('🐳 Docker is running but the Compose V2 plugin is missing.'));
      console.log(chalk.gray(`Version: ${result.version}\n`));

      console.log(chalk.bold('📦 Install Docker Compose V2:\n'));
      console.log(chalk.cyan('  • Docker Desktop: update to a recent version (Compose V2 is included)'));
      console.log(chalk.cyan('  • Debian/Ubuntu: sudo apt-get install docker-compose-plugin'));
      console.log(chalk.cyan('  • Other platforms: https://docs.docker.com/compose/install/'));
    } else if (!result.isRunning) {
      console.log(chalk.yellow('🐳 Docker is installed but not running.'));
      console.log(chalk.gray(`Version: ${result.version}\n`));
      
      console.log(chalk.bold('🚀 Start Docker:\n'));
      
      const platform = process.platform;
      
      switch (platform) {
        case 'darwin': // macOS
        case 'win32': // Windows
          console.log(chalk.cyan('• Start Docker Desktop application'));
          console.log(chalk.cyan('• Wait for Docker to fully initialize'));
          break;
          
        default: // Linux
          console.log(chalk.cyan('• sudo systemctl start docker'));
          console.log(chalk.cyan('• sudo systemctl enable docker  # Enable auto-start'));
          console.log(chalk.cyan('• Or start Docker Desktop if installed'));
          break;
      }
    }
    
    console.log(chalk.yellow('\n💡 After installing/starting Docker, try running your command again.'));
    console.log(chalk.gray('🔍 Verify Docker: docker --version && docker info\n'));
  }

  private async verifyDockerSetup(): Promise<void> {
    if (this.dockerVerified) {
      return; // Already verified in this session
    }
    
    const result = await this.checkDockerInstallation();

    if (!result.isInstalled || !result.isRunning || !result.composeAvailable) {
      this.showDockerInstallationInstructions(result);
      process.exit(1);
    }
    
    // Docker is ready
    this.dockerVerified = true;
    
    console.log(chalk.green(`✅ Docker ${result.version} is ready`));
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
    // Verify Docker setup before doing anything else
    await this.verifyDockerSetup();
    
    await this.loadExistingInstances();
    await this.loadComposeFile();
  }

  public async createDatabase(
    name: string,
    template: DatabaseTemplate,
    options: {
      port?: number;
      adminDashboard?: boolean;
      customEnv?: Record<string, string>;
    } = {}
  ): Promise<DatabaseInstance> {
    // Validate name
    if (this.instances.has(name)) {
      throw new Error(`Database instance '${name}' already exists`);
    }

    // Get default port for this engine
    const defaultPort = this.getDefaultPortForEngine(template.engine.name);
    
    // Only allocate port for databases that need them (not embedded)
    let port = 0;
    if (defaultPort > 0) {
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
      status: 'stopped',
      created_at: new Date().toISOString(),
      connection_uri: this.generateConnectionUri(template, port, name),
    };

    // Add to instances
    this.instances.set(name, instance);

    // Update compose file
    await this.updateComposeFile();

    // Save instances
    await this.saveInstances();

    return instance;
  }

  public async removeDatabase(name: string, options: { keepData?: boolean } = {}): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Database instance '${name}' not found`);
    }

    const serviceName = `${name}-db`;

    try {
      // Stop and remove container
      await this.executeDockerCompose(['stop', serviceName]);
      await this.executeDockerCompose(['rm', '-f', serviceName]);
    } catch (error) {
      console.warn(`Failed to stop/remove container for '${name}':`, error);
    }

    // Deallocate port if it was allocated
    if (instance.port > 0) {
      await deallocatePort(instance.port);
    }

    // Remove from instances
    this.instances.delete(name);

    // Clean up data directory unless the caller asked to keep it
    if (!options.keepData && await this.pathExists(instance.volume)) {
      await rm(instance.volume, { recursive: true });
    }

    // Update compose file and save instances
    await this.updateComposeFile();
    await this.saveInstances();
  }

  public async startDatabase(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Database instance '${name}' not found`);
    }

    // Ensure compose file is up to date
    await this.updateComposeFile();

    const serviceName = `${name}-db`;
    
    try {
      await this.executeDockerCompose(['up', '-d', serviceName]);
      instance.status = 'running';
      this.instances.set(name, instance);
      await this.saveInstances();
    } catch (error) {
      instance.status = 'error';
      this.instances.set(name, instance);
      await this.saveInstances();
      throw new Error(`Failed to start database '${name}': ${error}`);
    }
  }

  public async stopDatabase(name: string): Promise<void> {
    const instance = this.instances.get(name);
    if (!instance) {
      throw new Error(`Database instance '${name}' not found`);
    }

    // Ensure compose file exists
    await this.updateComposeFile();

    const serviceName = `${name}-db`;
    
    try {
      await this.executeDockerCompose(['stop', serviceName]);
      instance.status = 'stopped';
      this.instances.set(name, instance);
      await this.saveInstances();
    } catch (error) {
      instance.status = 'error';
      this.instances.set(name, instance);
      await this.saveInstances();
      throw new Error(`Failed to stop database '${name}': ${error}`);
    }
  }

  private async executeDockerCompose(args: string[]): Promise<string> {
    const composeFilePath = await getComposeFilePath();
    
    return new Promise((resolve, reject) => {
      const child = spawn('docker', ['compose', '-f', composeFilePath, ...args], {
        stdio: ['inherit', 'pipe', 'pipe']
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

  public async startAllDatabases(): Promise<void> {
    try {
      // Ensure compose file is up to date
      await this.updateComposeFile();
      
      await this.executeDockerCompose(['up', '-d']);
      for (const [name, instance] of this.instances) {
        instance.status = 'running';
        this.instances.set(name, instance);
      }
      await this.saveInstances();
    } catch (error) {
      for (const [name, instance] of this.instances) {
        instance.status = 'error';
        this.instances.set(name, instance);
      }
      await this.saveInstances();
      throw new Error(`Failed to start databases: ${error}`);
    }
  }

  public async stopAllDatabases(): Promise<void> {
    try {
      // Ensure compose file exists
      await this.updateComposeFile();
      
      await this.executeDockerCompose(['stop']);
      for (const [name, instance] of this.instances) {
        instance.status = 'stopped';
        this.instances.set(name, instance);
      }
      await this.saveInstances();
    } catch (error) {
      for (const [name, instance] of this.instances) {
        instance.status = 'error';
        this.instances.set(name, instance);
      }
      await this.saveInstances();
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
    return this.getAllInstances().filter(instance => instance.status === 'running');
  }

  public getStoppedInstances(): DatabaseInstance[] {
    return this.getAllInstances().filter(instance => instance.status === 'stopped');
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
      const serviceName = `${name}-db`;
      const defaultPort = this.getDefaultPortForEngine(instance.engine);
      
      const serviceConfig: any = {
        image: this.getImageForEngine(instance.engine),
        volumes: [`${instance.volume}:${this.getDefaultVolumeForEngine(instance.engine)}`],
        environment: instance.environment,
        restart: config.defaults.restart_policy,
        healthcheck: this.getHealthcheckForEngine(instance.engine),
      };

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

  private generateConnectionUri(template: DatabaseTemplate, port: number, dbName: string): string {
    const engine = template.engine;
    const env = engine.environment;

    switch (engine.name) {
      case 'postgresql':
        return `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@localhost:${port}/${env.POSTGRES_DB}`;
      
      case 'mariadb':
        return `mysql://${env.MYSQL_USER}:${env.MYSQL_PASSWORD}@localhost:${port}/${env.MYSQL_DATABASE}`;
      
      case 'redis':
        return `redis://:${env.REDIS_PASSWORD}@localhost:${port}`;
      
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
        return `sqlite:///${dbName}.db`;
      
      case 'duckdb':
        return `duckdb:///${dbName}.duckdb`;
      
      case 'leveldb':
        return `leveldb:///${dbName}`;
      
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

  private getImageForEngine(engineName: string): string {
    const imageMap: Record<string, string> = {
      postgresql: 'postgres:16-alpine',
      mariadb: 'mariadb:11',
      redis: 'redis:7.0-alpine',
      cassandra: 'cassandra:4.1',
      qdrant: 'qdrant/qdrant:v1.7.0',
      weaviate: 'semitechnologies/weaviate:1.23.0',
      milvus: 'milvusdb/milvus:v2.3.0',
      arangodb: 'arangodb:3.11',
      meilisearch: 'getmeili/meilisearch:v1.5',
      typesense: 'typesense/typesense:0.25.0',
      sqlite: 'alpine:latest',
      duckdb: 'alpine:latest',
      leveldb: 'alpine:latest',
      // Time Series Databases
      influxdb3: 'influxdb:latest',
      influxdb2: 'influxdb:2.7-alpine',
      timescaledb: 'timescale/timescaledb:latest-pg16',
      questdb: 'questdb/questdb:latest',
      victoriametrics: 'victoriametrics/victoria-metrics:latest',
      horaedb: 'apache/horaedb:latest',
    };

    return imageMap[engineName] || 'alpine:latest';
  }

  private getDefaultPortForEngine(engineName: string): number {
    const portMap: Record<string, number> = {
      postgresql: 5432,
      mariadb: 3306,
      redis: 6379,
      cassandra: 9042,
      qdrant: 6333,
      weaviate: 8080,
      milvus: 19530,
      arangodb: 8529,
      meilisearch: 7700,
      typesense: 8108,
      sqlite: 0, // No port for embedded
      duckdb: 0, // No port for embedded
      leveldb: 0, // No port for embedded
      // Time Series Databases
      influxdb3: 8086,
      influxdb2: 8086,
      timescaledb: 5432,
      questdb: 9000,
      victoriametrics: 8428,
      horaedb: 8831,
    };

    return portMap[engineName] || 8080;
  }

  private getDefaultVolumeForEngine(engineName: string): string {
    const volumeMap: Record<string, string> = {
      postgresql: '/var/lib/postgresql/data',
      mariadb: '/var/lib/mysql',
      redis: '/data',
      cassandra: '/var/lib/cassandra',
      qdrant: '/qdrant/storage',
      weaviate: '/var/lib/weaviate',
      milvus: '/var/lib/milvus',
      arangodb: '/var/lib/arangodb3',
      meilisearch: '/meili_data',
      typesense: '/data',
      sqlite: '/data',
      duckdb: '/data',
      leveldb: '/data',
      // Time Series Databases
      influxdb3: '/var/lib/influxdb3',
      influxdb2: '/var/lib/influxdb2',
      timescaledb: '/var/lib/postgresql/data',
      questdb: '/var/lib/questdb',
      victoriametrics: '/victoria-metrics-data',
      horaedb: '/opt/horaedb',
    };

    return volumeMap[engineName] || '/data';
  }

  private getHealthcheckForEngine(engineName: string): any {
    const healthcheckMap: Record<string, any> = {
      postgresql: {
        test: 'pg_isready -U admin -d database',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      mariadb: {
        test: 'healthcheck.sh --connect --innodb_initialized',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      redis: {
        test: 'redis-cli ping',
        interval: '10s',
        timeout: '3s',
        retries: 5,
      },
      cassandra: {
        test: 'nodetool status',
        interval: '30s',
        timeout: '10s',
        retries: 5,
      },
      qdrant: {
        test: 'wget --no-verbose --tries=1 --spider http://localhost:6333/health || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      weaviate: {
        test: 'wget --no-verbose --tries=1 --spider http://localhost:8080/v1/.well-known/ready || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      milvus: {
        test: 'curl -f http://localhost:9091/healthz || exit 1',
        interval: '30s',
        timeout: '10s',
        retries: 5,
      },
      arangodb: {
        test: 'curl -f http://localhost:8529/_api/version || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      meilisearch: {
        test: 'wget --no-verbose --tries=1 --spider http://localhost:7700/health || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      typesense: {
        test: 'curl -f http://localhost:8108/health || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      // Time Series Databases
      influxdb3: {
        test: 'curl -f http://localhost:8086/health || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      influxdb2: {
        test: 'curl -f http://localhost:8086/health || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      timescaledb: {
        test: 'pg_isready -U admin -d hayai_db',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      questdb: {
        test: 'curl -f http://localhost:9000/status || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      victoriametrics: {
        test: 'wget --no-verbose --tries=1 --spider http://localhost:8428/health || exit 1',
        interval: '10s',
        timeout: '5s',
        retries: 5,
      },
      horaedb: {
        test: 'curl -f http://localhost:8831/health || exit 1',
        interval: '30s',
        timeout: '10s',
        retries: 5,
      },
    };

    return healthcheckMap[engineName] || {
      test: 'echo "healthy"',
      interval: '30s',
      timeout: '10s',
      retries: 3,
    };
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
  } = {}
): Promise<DatabaseInstance> => {
  const manager = DockerManager.getInstance();
  await manager.initialize();
  return await manager.createDatabase(name, template, options);
};

export const removeDatabase = async (
  name: string,
  options: { keepData?: boolean } = {}
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