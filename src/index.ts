// Public programmatic surface for hayai-db. The CLI (src/cli) is the primary
// product; these exports let other tooling reuse the engine catalog, the shared
// types, and the instance/backup managers without shelling out to the binary.

export * from './core/types.js';

export {
  DatabaseTemplates,
  getTemplate,
  getAllTemplates,
  getTemplatesByType,
  getAvailableEngines,
  getAvailableTypes,
  isEngineSupported,
  getEnginesByType,
  getOpenSourceInfo,
  getEngineTier,
} from './core/templates.js';
export { ExitCode } from './core/exit-codes.js';
export type { ExitCodeValue } from './core/exit-codes.js';
export type { JsonEnvelope } from './core/output.js';

export { buildConnectionInfo } from './core/connection.js';
export type { ConnectionInfo } from './core/connection.js';
export { DockerManager, getDockerManager } from './core/docker.js';
export { HayaiDbManager } from './core/hayaidb.js';
export { SecurityManager, getSecurityManager, recordOperation } from './core/security.js';
export type { SecurityCredentials, SecurityPolicy, AuditLog } from './core/security.js';
