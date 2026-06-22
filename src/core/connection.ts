import { DatabaseInstance } from './types.js';

export interface ConnectionInfo {
  name: string;
  engine: string;
  status: string;
  host: string;
  port: number | null;
  uri: string;
}

// Everything `connect` reports is already on the instance record; this keeps the
// shaping pure (no CLI/Docker imports) so it stays unit-testable. Host is always
// localhost — hayai publishes containers on the host's loopback.
export function buildConnectionInfo(instance: DatabaseInstance): ConnectionInfo {
  return {
    name: instance.name,
    engine: instance.engine,
    status: instance.status,
    host: 'localhost',
    port: instance.port > 0 ? instance.port : null,
    uri: instance.connection_uri,
  };
}
