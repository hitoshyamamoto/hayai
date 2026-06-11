import crypto from 'crypto';
import { readFile, writeFile, mkdir, chmod } from 'fs/promises';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { spawn } from 'child_process';

export interface SecurityCredentials {
  username: string;
  password: string;
  database?: string;
  encrypted: boolean;
  createdAt: string;
  lastUsed?: string;
}

export interface SecurityPolicy {
  requireAuthentication: boolean;
  allowCrossEngineOperations: boolean;
  enableNetworkIsolation: boolean;
  auditOperations: boolean;
  maxOperationsPerHour: number;
  allowedOperations: string[];
}

export interface AuditLog {
  timestamp: string;
  operation: string;
  source: string;
  target: string;
  user: string;
  success: boolean;
  error?: string;
  ipAddress?: string;
}

export class SecurityManager {
  private static instance: SecurityManager;
  private readonly encryptionKey: string;
  private readonly credentialsPath: string;
  private readonly auditLogPath: string;
  private readonly securityPolicyPath: string;
  private operationCounts: Map<string, number> = new Map();
  
  private constructor() {
    this.encryptionKey = this.getOrCreateEncryptionKey();
    this.credentialsPath = path.join(process.cwd(), '.hayai', 'credentials.enc');
    this.auditLogPath = path.join(process.cwd(), '.hayai', 'audit.log');
    this.securityPolicyPath = path.join(process.cwd(), '.hayai', 'security.json');
  }

  public static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  /**
   * Generates or retrieves unique encryption key per installation
   */
  private getOrCreateEncryptionKey(): string {
    const keyPath = path.join(process.cwd(), '.hayai', '.key');
    
    try {
      return readFileSync(keyPath, 'utf8');
    } catch {
      const key = crypto.randomBytes(32).toString('hex');
      try {
        mkdirSync(path.dirname(keyPath), { recursive: true });
        writeFileSync(keyPath, key);
        chmodSync(keyPath, 0o600); // Only owner can read
      } catch {
        console.warn(chalk.yellow('⚠️  Could not save encryption key securely'));
      }
      return key;
    }
  }

  /**
   * Encrypts sensitive data
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypts sensitive data
   */
  private decrypt(text: string): string {
    const [ivHex, encryptedHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Generates secure random password
   */
  public generateSecurePassword(length: number = 16): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    
    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }
    
    return password;
  }

  /**
   * Stores credentials securely
   */
  public async storeCredentials(instanceName: string, credentials: Omit<SecurityCredentials, 'encrypted' | 'createdAt'>): Promise<void> {
    try {
      await mkdir(path.dirname(this.credentialsPath), { recursive: true });
      
      let existingCredentials: Record<string, SecurityCredentials> = {};
      
      try {
        const encryptedData = await readFile(this.credentialsPath, 'utf8');
        const decryptedData = this.decrypt(encryptedData);
        existingCredentials = JSON.parse(decryptedData);
      } catch {
        // File doesn't exist or is corrupted - start fresh
      }
      
      existingCredentials[instanceName] = {
        ...credentials,
        password: this.encrypt(credentials.password),
        encrypted: true,
        createdAt: new Date().toISOString()
      };
      
      const encryptedCredentials = this.encrypt(JSON.stringify(existingCredentials));
      await writeFile(this.credentialsPath, encryptedCredentials);
      
      // Set restrictive permissions
      await chmod(this.credentialsPath, 0o600);
      
    } catch (error) {
      throw new Error(`Failed to store credentials securely: ${error}`);
    }
  }

  /**
   * Retrieves credentials securely
   */
  public async getCredentials(instanceName: string): Promise<SecurityCredentials | null> {
    try {
      const encryptedData = await readFile(this.credentialsPath, 'utf8');
      const decryptedData = this.decrypt(encryptedData);
      const credentials = JSON.parse(decryptedData);
      
      if (credentials[instanceName]) {
        const creds = credentials[instanceName];
        creds.password = this.decrypt(creds.password);
        creds.lastUsed = new Date().toISOString();
        
        // Update last used timestamp
        await this.storeCredentials(instanceName, creds);
        
        return creds;
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validates if operation is allowed
   */
  public async validateOperation(
    operation: string, 
    sourceInstance: string, 
    targetInstance?: string,
    user: string = 'local'
  ): Promise<{ allowed: boolean; reason?: string }> {
    
    const policy = await this.getSecurityPolicy();
    
    // Check if operation is allowed
    if (!policy.allowedOperations.includes(operation)) {
      return { allowed: false, reason: `Operation '${operation}' is not permitted by security policy` };
    }
    
    // Check rate limiting
    const operationKey = `${user}:${operation}`;
    const currentCount = this.operationCounts.get(operationKey) || 0;
    
    if (currentCount >= policy.maxOperationsPerHour) {
      return { allowed: false, reason: `Rate limit exceeded: ${policy.maxOperationsPerHour} operations per hour` };
    }
    
    // Check cross-engine operations
    if (targetInstance && !policy.allowCrossEngineOperations) {
      // This would need engine comparison logic
      // For now, assume different engines if different names
    }
    
    // Increment operation count
    this.operationCounts.set(operationKey, currentCount + 1);
    
    // Reset counts every hour
    setTimeout(() => {
      this.operationCounts.delete(operationKey);
    }, 60 * 60 * 1000);
    
    return { allowed: true };
  }

  /**
   * Creates network isolation for operation
   */
  public async createNetworkIsolation(): Promise<string> {
    const networkName = `hayai-op-${crypto.randomUUID().substring(0, 8)}`;
    
    return new Promise((resolve, reject) => {
      const createNetwork = spawn('docker', [
        'network', 'create',
        '--driver', 'bridge',
        '--internal', // Isolates from external networks
        '--opt', 'com.docker.network.bridge.enable_icc=true', // Enable inter-container communication
        networkName
      ]);
      
      createNetwork.on('close', (code) => {
        if (code === 0) {
          console.log(chalk.green(`🔒 Created isolated network: ${networkName}`));
          resolve(networkName);
        } else {
          reject(new Error('Failed to create isolated network'));
        }
      });
      
      createNetwork.on('error', reject);
    });
  }

  /**
   * Connects containers to isolated network
   */
  public async connectToNetwork(networkName: string, containerName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const connect = spawn('docker', [
        'network', 'connect', networkName, containerName
      ]);
      
      connect.on('close', (code) => {
        code === 0 ? resolve() : reject(new Error(`Failed to connect ${containerName} to network`));
      });
      
      connect.on('error', reject);
    });
  }

  /**
   * Removes isolated network after operation
   */
  public async cleanupNetwork(networkName: string): Promise<void> {
    return new Promise((resolve) => {
      const cleanup = spawn('docker', [
        'network', 'rm', networkName
      ]);
      
      cleanup.on('close', () => {
        console.log(chalk.green(`🧹 Cleaned up network: ${networkName}`));
        resolve();
      });
      
      cleanup.on('error', () => resolve()); // Don't fail on cleanup errors
    });
  }

  /**
   * Records operation in audit log
   */
  public async auditLog(log: AuditLog): Promise<void> {
    try {
      await mkdir(path.dirname(this.auditLogPath), { recursive: true });
      
      const logEntry = JSON.stringify(log) + '\n';
      await writeFile(this.auditLogPath, logEntry, { flag: 'a' });
      
      console.log(chalk.gray(`📋 Audit: ${log.operation} ${log.source}${log.target ? ` → ${log.target}` : ''} ${log.success ? '✅' : '❌'}`));
      
    } catch (error) {
      console.warn(chalk.yellow(`⚠️  Failed to write audit log: ${error}`));
    }
  }

  /**
   * Gets security policy
   */
  public async getSecurityPolicy(): Promise<SecurityPolicy> {
    try {
      const policyData = await readFile(this.securityPolicyPath, 'utf8');
      return JSON.parse(policyData);
    } catch {
      // Return default policy
      const defaultPolicy: SecurityPolicy = {
        requireAuthentication: false, // Start permissive for local development
        allowCrossEngineOperations: true,
        enableNetworkIsolation: false,
        auditOperations: true,
        maxOperationsPerHour: 50,
        allowedOperations: ['clone', 'merge', 'migrate', 'backup', 'restore']
      };
      
      await this.saveSecurityPolicy(defaultPolicy);
      return defaultPolicy;
    }
  }

  /**
   * Saves security policy
   */
  public async saveSecurityPolicy(policy: SecurityPolicy): Promise<void> {
    try {
      await mkdir(path.dirname(this.securityPolicyPath), { recursive: true });
      await writeFile(this.securityPolicyPath, JSON.stringify(policy, null, 2));
    } catch (error) {
      throw new Error(`Failed to save security policy: ${error}`);
    }
  }

  /**
   * Creates secure credentials for new instance
   */
  public async createSecureCredentials(instanceName: string, engine: string): Promise<SecurityCredentials> {
    const credentials: SecurityCredentials = {
      username: engine === 'redis' ? '' : 'admin',
      password: this.generateSecurePassword(),
      database: engine === 'postgresql' || engine === 'mariadb' ? 'database' : undefined,
      encrypted: false,
      createdAt: new Date().toISOString()
    };
    
    await this.storeCredentials(instanceName, credentials);
    
    return credentials;
  }

  /**
   * Executes secure command with credentials
   */
  public async executeSecureCommand(
    command: string[],
    instanceName: string,
    operation: string
  ): Promise<string> {
    let success = false;
    let error: string | undefined;
    
    try {
      // Validate operation
      const validation = await this.validateOperation(operation, instanceName);
      if (!validation.allowed) {
        throw new Error(validation.reason);
      }
      
      // Get credentials
      const credentials = await this.getCredentials(instanceName);
      if (!credentials) {
        throw new Error(`No credentials found for instance: ${instanceName}`);
      }
      
      // Execute command with credentials injected securely
      const result = await this.runSecureCommand(command, credentials);
      success = true;
      
      return result;
      
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      // Audit log
      await this.auditLog({
        timestamp: new Date().toISOString(),
        operation,
        source: instanceName,
        target: '',
        user: 'local',
        success,
        error
      });
    }
  }

  /**
   * Executes command with secure environment variables
   */
  private async runSecureCommand(command: string[], credentials: SecurityCredentials): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PGPASSWORD: credentials.password,
        MYSQL_PWD: credentials.password,
        REDIS_PASSWORD: credentials.password
      };
      
      const child = spawn(command[0], command.slice(1), {
        env,
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
          reject(new Error(`Command failed: ${stderr}`));
        }
      });
      
      child.on('error', reject);
    });
  }

  /**
   * Validates data integrity after operation
   */
  public async validateDataIntegrity(instanceName: string, engine: string): Promise<boolean> {
    try {
      const credentials = await this.getCredentials(instanceName);
      if (!credentials) return false;
      
      switch (engine) {
        case 'postgresql':
          // Check if database is accessible and has tables
          await this.runSecureCommand([
            'docker', 'exec', `${instanceName}-db`,
            'psql', '-U', credentials.username, '-d', credentials.database || 'database',
            '-c', 'SELECT COUNT(*) FROM information_schema.tables;'
          ], credentials);
          break;
          
        case 'redis':
          // Check if Redis is responsive
          await this.runSecureCommand([
            'docker', 'exec', `${instanceName}-db`,
            'redis-cli', '-a', credentials.password, 'ping'
          ], credentials);
          break;
          
        default:
          console.log(chalk.yellow(`⚠️  Data integrity check not implemented for ${engine}`));
      }
      
      return true;
    } catch {
      return false;
    }
  }
}

export const getSecurityManager = (): SecurityManager => {
  return SecurityManager.getInstance();
}; 