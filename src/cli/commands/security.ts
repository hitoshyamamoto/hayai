import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { getSecurityManager, SecurityPolicy } from '../../core/security.js';
import { CLIOptions } from '../../core/types.js';

interface SecurityOptions extends CLIOptions {
  init?: boolean;
  policy?: boolean;
  audit?: boolean;
  credentials?: boolean;
  generate?: boolean;
}

async function initializeSecurity(): Promise<void> {
  const securityManager = getSecurityManager();
  
  console.log(chalk.cyan('\n🔒 Hayai Security Configuration\n'));
  
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAudit',
      message: 'Enable audit logging for all operations?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'enableNetworkIsolation',
      message: 'Enable network isolation for sensitive operations?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'allowCrossEngine',
      message: 'Allow cross-engine operations (migrate/merge between different database types)?',
      default: true,
    },
    {
      type: 'number',
      name: 'maxOperationsPerHour',
      message: 'Maximum operations per hour per user:',
      default: 50,
      validate: (input) => input > 0 || 'Must be greater than 0',
    },
    {
      type: 'checkbox',
      name: 'allowedOperations',
      message: 'Select allowed operations:',
      choices: [
        { name: 'Clone databases', value: 'clone', checked: true },
        { name: 'Merge databases', value: 'merge', checked: true },
        { name: 'Migrate databases', value: 'migrate', checked: true },
        { name: 'Backup databases', value: 'backup', checked: true },
        { name: 'Restore databases', value: 'restore', checked: true },
      ],
    },
  ]);
  
  const policy: SecurityPolicy = {
    requireAuthentication: false, // Start with local development friendly settings
    allowCrossEngineOperations: answers.allowCrossEngine,
    enableNetworkIsolation: answers.enableNetworkIsolation,
    auditOperations: answers.enableAudit,
    maxOperationsPerHour: answers.maxOperationsPerHour,
    allowedOperations: answers.allowedOperations,
  };
  
  await securityManager.saveSecurityPolicy(policy);
  
  console.log(chalk.green('\n✅ Security policy configured successfully!'));
  console.log(chalk.gray('Policy saved to: .hayai/security.json'));
  
  if (policy.auditOperations) {
    console.log(chalk.gray('Audit logs will be saved to: .hayai/audit.log'));
  }
  
  if (policy.enableNetworkIsolation) {
    console.log(chalk.yellow('\n⚠️  Network isolation enabled:'));
    console.log(chalk.gray('• Operations will create isolated Docker networks'));
    console.log(chalk.gray('• This may slow down operations but increases security'));
  }
}

async function showSecurityPolicy(): Promise<void> {
  const securityManager = getSecurityManager();
  const policy = await securityManager.getSecurityPolicy();
  
  console.log(chalk.cyan('\n🔒 Current Security Policy\n'));
  
  console.log(chalk.bold('Authentication:'));
  console.log(`  Required: ${policy.requireAuthentication ? chalk.red('Yes') : chalk.green('No')}`);
  
  console.log(chalk.bold('\nOperations:'));
  console.log(`  Cross-engine operations: ${policy.allowCrossEngineOperations ? chalk.green('Allowed') : chalk.red('Blocked')}`);
  console.log(`  Network isolation: ${policy.enableNetworkIsolation ? chalk.green('Enabled') : chalk.yellow('Disabled')}`);
  console.log(`  Rate limit: ${chalk.cyan(policy.maxOperationsPerHour)} operations/hour`);
  
  console.log(chalk.bold('\nAllowed Operations:'));
  policy.allowedOperations.forEach(op => {
    console.log(`  • ${chalk.green(op)}`);
  });
  
  console.log(chalk.bold('\nAudit:'));
  console.log(`  Logging: ${policy.auditOperations ? chalk.green('Enabled') : chalk.red('Disabled')}`);
  
  console.log(chalk.gray('\n💡 Use `hayai security --init` to reconfigure'));
}

async function showAuditLogs(): Promise<void> {
  try {
    const fs = await import('fs/promises');
    const auditPath = '.hayai/audit.log';
    
    const auditData = await fs.readFile(auditPath, 'utf8');
    const logs = auditData.trim().split('\n').filter(line => line.trim());
    
    console.log(chalk.cyan(`\n📋 Audit Logs (${logs.length} entries)\n`));
    
    if (logs.length === 0) {
      console.log(chalk.gray('No audit entries found'));
      return;
    }
    
    // Show last 20 entries
    const recentLogs = logs.slice(-20);
    
    recentLogs.forEach(logLine => {
      try {
        const log = JSON.parse(logLine);
        const timestamp = new Date(log.timestamp).toLocaleString();
        const status = log.success ? chalk.green('✅') : chalk.red('❌');
        const target = log.target ? ` → ${log.target}` : '';
        
        console.log(`${status} ${chalk.gray(timestamp)} ${chalk.cyan(log.operation)} ${log.source}${target}`);
        
        if (log.error) {
          console.log(`    ${chalk.red('Error:')} ${log.error}`);
        }
      } catch {
        console.log(chalk.gray(`Invalid log entry: ${logLine}`));
      }
    });
    
    if (logs.length > 20) {
      console.log(chalk.gray(`\n... and ${logs.length - 20} more entries`));
    }
    
  } catch (error) {
    console.log(chalk.yellow('⚠️  No audit log file found'));
    console.log(chalk.gray('Enable audit logging with: hayai security --init'));
  }
}

async function manageCredentials(): Promise<void> {
  const securityManager = getSecurityManager();
  
  console.log(chalk.cyan('\n🔑 Credential Management\n'));
  
  const action = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Generate secure password', value: 'generate' },
        { name: 'View stored credentials (masked)', value: 'view' },
        { name: 'Update instance credentials', value: 'update' },
        { name: 'Remove instance credentials', value: 'remove' },
      ],
    },
  ]);
  
  switch (action.action) {
    case 'generate': {
      const length = await inquirer.prompt([
        {
          type: 'number',
          name: 'length',
          message: 'Password length:',
          default: 16,
          validate: (input) => input >= 8 || 'Minimum length is 8 characters',
        },
      ]);
      
      const password = securityManager.generateSecurePassword(length.length);
      console.log(chalk.green('\n🔑 Generated password:'));
      console.log(chalk.bold(password));
      console.log(chalk.gray('\n💡 Copy this password immediately - it won\'t be shown again'));
      break;
    }
      
    case 'view': {
      console.log(chalk.yellow('\n⚠️  This feature requires accessing the encrypted credential store'));
      console.log(chalk.gray('For security reasons, passwords are never displayed in plain text'));
      break;
    }
      
    case 'update': {
      const { instanceName, newPassword } = await inquirer.prompt([
        {
          type: 'input',
          name: 'instanceName',
          message: 'Instance name:',
          validate: (input) => input.trim().length > 0 || 'Instance name is required',
        },
        {
          type: 'password',
          name: 'newPassword',
          message: 'New password (leave empty to generate):',
        },
      ]);
      
      const finalPassword = newPassword || securityManager.generateSecurePassword();
      
      try {
        await securityManager.storeCredentials(instanceName, {
          username: 'admin',
          password: finalPassword,
        });
        
        console.log(chalk.green(`\n✅ Credentials updated for instance: ${instanceName}`));
        
        if (!newPassword) {
          console.log(chalk.yellow('Generated password:'), chalk.bold(finalPassword));
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to update credentials:'), error);
      }
      break;
    }
      
    case 'remove': {
      console.log(chalk.red('\n⚠️  Credential removal not yet implemented'));
      console.log(chalk.gray('This feature will be added in a future version'));
      break;
    }
  }
}

async function handleSecurity(options: SecurityOptions): Promise<void> {
  if (options.init) {
    await initializeSecurity();
    return;
  }
  
  if (options.policy) {
    await showSecurityPolicy();
    return;
  }
  
  if (options.audit) {
    await showAuditLogs();
    return;
  }
  
  if (options.credentials) {
    await manageCredentials();
    return;
  }
  
  if (options.generate) {
    const securityManager = getSecurityManager();
    const password = securityManager.generateSecurePassword();
    console.log(chalk.green('\n🔑 Generated secure password:'));
    console.log(chalk.bold(password));
    return;
  }
  
  // Default: Show security overview
  console.log(chalk.cyan('\n🔒 Hayai Security Center\n'));
  
  const securityManager = getSecurityManager();
  const policy = await securityManager.getSecurityPolicy();
  
  console.log(chalk.bold('Security Status:'));
  console.log(chalk.yellow('  ⚠️  The policy below is configuration only — it is not yet'));
  console.log(chalk.yellow('     enforced by clone/merge or other data commands. See SECURITY.md.'));

  // Check security settings
  const securityScore = calculateSecurityScore(policy);
  const scoreColor = securityScore >= 80 ? chalk.green : securityScore >= 60 ? chalk.yellow : chalk.red;

  console.log(`  Security Score: ${scoreColor(securityScore)}/100`);
  console.log(`  Audit Logging: ${policy.auditOperations ? chalk.green('✅ Enabled') : chalk.red('❌ Disabled')}`);
  console.log(`  Network Isolation: ${policy.enableNetworkIsolation ? chalk.green('✅ Enabled') : chalk.yellow('⚠️  Optional')}`);
  console.log(`  Rate Limiting: ${chalk.cyan(policy.maxOperationsPerHour)} ops/hour`);
  
  console.log(chalk.bold('\nRecommendations:'));
  
  if (!policy.auditOperations) {
    console.log(chalk.red('  • Enable audit logging for compliance'));
  }
  
  if (!policy.enableNetworkIsolation && policy.allowCrossEngineOperations) {
    console.log(chalk.yellow('  • Consider network isolation for cross-engine operations'));
  }
  
  if (policy.maxOperationsPerHour > 100) {
    console.log(chalk.yellow('  • Consider lowering rate limits for production use'));
  }
  
  console.log(chalk.bold('\nAvailable Commands:'));
  console.log(`  ${chalk.cyan('hayai security --init')}         Configure security policy`);
  console.log(`  ${chalk.cyan('hayai security --policy')}       View current policy`);
  console.log(`  ${chalk.cyan('hayai security --audit')}        View audit logs`);
  console.log(`  ${chalk.cyan('hayai security --credentials')}  Manage credentials`);
  console.log(`  ${chalk.cyan('hayai security --generate')}     Generate secure password`);
}

function calculateSecurityScore(policy: SecurityPolicy): number {
  let score = 0;
  
  // Base score
  score += 20;
  
  // Audit logging
  if (policy.auditOperations) score += 25;
  
  // Network isolation
  if (policy.enableNetworkIsolation) score += 20;
  
  // Rate limiting
  if (policy.maxOperationsPerHour <= 50) score += 15;
  else if (policy.maxOperationsPerHour <= 100) score += 10;
  
  // Operation restrictions
  if (policy.allowedOperations.length <= 3) score += 10;
  else if (policy.allowedOperations.length <= 5) score += 5;
  
  // Cross-engine restrictions
  if (!policy.allowCrossEngineOperations) score += 10;
  
  return Math.min(score, 100);
}

export const securityCommand = new Command('security')
  .description('Configure and manage Hayai security settings')
  .option('--init', 'Initialize security configuration')
  .option('--policy', 'Show current security policy')
  .option('--audit', 'Show audit logs')
  .option('--credentials', 'Manage database credentials')
  .option('--generate', 'Generate a secure password')
  .option('--verbose', 'Enable verbose output')
  .addHelpText('after', `
${chalk.bold('Status:')}
  ${chalk.yellow('⚠️  These are standalone utilities. The security policy, audit log,')}
  ${chalk.yellow('and stored credentials are NOT yet enforced or used by the data')}
  ${chalk.yellow('commands (clone, merge, snapshot, ...). See SECURITY.md for details.')}

${chalk.bold('What this command provides today:')}

${chalk.cyan('🔐 Credential Utilities:')}
  • Random password generation (crypto-based)
  • Per-instance credential storage, AES-256-CBC encrypted at rest
  • The key lives next to the ciphertext (.hayai/.key, mode 0600) —
    this deters casual reading, it is not a vault

${chalk.cyan('📋 Policy & Audit Files:')}
  • Writes .hayai/security.json and reads .hayai/audit.log
  • Operations do not consult or write these yet

${chalk.bold('Examples:')}
  ${chalk.cyan('# Configure security for the first time')}
  hayai security --init

  ${chalk.cyan('# Check current security status')}
  hayai security

  ${chalk.cyan('# View recent audit logs')}
  hayai security --audit

  ${chalk.cyan('# Generate a secure password')}
  hayai security --generate

  ${chalk.cyan('# Manage database credentials')}
  hayai security --credentials

${chalk.bold('Security Best Practices:')}
  ${chalk.yellow('⚠️  Enable audit logging for production environments')}
  ${chalk.yellow('⚠️  Use network isolation for cross-engine operations')}
  ${chalk.yellow('⚠️  Regularly rotate database passwords')}
  ${chalk.yellow('⚠️  Monitor audit logs for suspicious activity')}
  ${chalk.yellow('⚠️  Backup .hayai directory securely (contains encrypted credentials)')}

${chalk.bold('Files & Directories:')}
  ${chalk.gray('.hayai/credentials.enc')}  - Encrypted credentials storage
  ${chalk.gray('.hayai/security.json')}    - Security policy configuration
  ${chalk.gray('.hayai/audit.log')}        - Operation audit log
  ${chalk.gray('.hayai/.key')}            - Encryption key (keep secure!)
`)
  .action(handleSecurity); 