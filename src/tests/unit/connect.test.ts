import { buildConnectionInfo } from '../../core/connection.js';
import { DatabaseInstance } from '../../core/types.js';

const baseInstance: DatabaseInstance = {
  name: 'app-db',
  engine: 'postgresql',
  port: 5432,
  volume: '/data/app-db',
  environment: { POSTGRES_USER: 'postgres' },
  status: 'running',
  created_at: '2026-06-22T00:00:00.000Z',
  connection_uri: 'postgresql://postgres@localhost:5432/app-db',
};

describe('buildConnectionInfo', () => {
  it('mirrors the instance record and always reports localhost', () => {
    expect(buildConnectionInfo(baseInstance)).toEqual({
      name: 'app-db',
      engine: 'postgresql',
      status: 'running',
      host: 'localhost',
      port: 5432,
      uri: 'postgresql://postgres@localhost:5432/app-db',
    });
  });

  it('reports a null port for embedded engines that publish nothing', () => {
    const embedded: DatabaseInstance = {
      ...baseInstance,
      name: 'notes',
      engine: 'sqlite',
      port: 0,
      status: 'embedded',
      connection_uri: 'sqlite:///data/notes/notes.db',
    };

    const info = buildConnectionInfo(embedded);
    expect(info.port).toBeNull();
    expect(info.uri).toBe('sqlite:///data/notes/notes.db');
  });
});
