import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { constants } from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { HayaiConfig } from './types.js';

export class ConfigManager {
  private static instance: ConfigManager;
  private config: HayaiConfig | null = null;
  private readonly configPath: string;

  private constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'hayai.config.yaml');
  }

  public static getInstance(configPath?: string): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager(configPath);
    }
    return ConfigManager.instance;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  public async loadConfig(): Promise<HayaiConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      if (await this.pathExists(this.configPath)) {
        const configContent = await readFile(this.configPath, 'utf-8');
        this.config = yaml.parse(configContent) as HayaiConfig;
      } else {
        this.config = this.getDefaultConfig();
        await this.saveConfig();
      }
      return this.config;
    } catch (error) {
      console.error('Failed to load configuration:', error);
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }

  public async saveConfig(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration to save');
    }

    try {
      // Ensure directory exists
      await this.ensureDir(path.dirname(this.configPath));

      const configContent = yaml.stringify(this.config, {
        indent: 2,
        lineWidth: 80,
        minContentWidth: 20,
      });
      await writeFile(this.configPath, configContent, 'utf-8');
    } catch (error) {
      console.error('Failed to save configuration:', error);
      throw error;
    }
  }

  public getConfig(): HayaiConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  public updateConfig(updates: Partial<HayaiConfig>): void {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    this.config = { ...this.config, ...updates };
  }

  public getDataDirectory(): string {
    return path.resolve(this.getConfig().docker.data_directory);
  }

  public getComposeFilePath(): string {
    return path.resolve(this.getConfig().docker.compose_file);
  }

  public getLogFilePath(): string {
    return path.resolve(this.getConfig().logging.file);
  }

  public getPortRange(): { start: number; end: number } {
    return this.getConfig().defaults.port_range;
  }

  private getDefaultConfig(): HayaiConfig {
    return {
      version: '1.0.0',
      docker: {
        network_name: 'hayai-network',
        compose_file: 'docker-compose.yml',
        data_directory: './data',
      },
      logging: {
        level: 'info',
        file: 'hayai.log',
      },
      defaults: {
        port_range: {
          start: 5000,
          end: 6000,
        },
        volume_driver: 'local',
        restart_policy: 'unless-stopped',
      },
    };
  }
}

// Convenience functions for global access
export const getConfig = async (): Promise<HayaiConfig> => {
  const manager = ConfigManager.getInstance();
  return await manager.loadConfig();
};

export const updateConfig = async (updates: Partial<HayaiConfig>): Promise<void> => {
  const manager = ConfigManager.getInstance();
  await manager.loadConfig();
  manager.updateConfig(updates);
  await manager.saveConfig();
};

export const getDataDirectory = async (): Promise<string> => {
  const manager = ConfigManager.getInstance();
  await manager.loadConfig();
  return manager.getDataDirectory();
};

export const getComposeFilePath = async (): Promise<string> => {
  const manager = ConfigManager.getInstance();
  await manager.loadConfig();
  return manager.getComposeFilePath();
};

export const getLogFilePath = async (): Promise<string> => {
  const manager = ConfigManager.getInstance();
  await manager.loadConfig();
  return manager.getLogFilePath();
};
