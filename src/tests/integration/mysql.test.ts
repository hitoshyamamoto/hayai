import {
  composeExec,
  createProject,
  destroyProject,
  latestSnapshot,
  runCli,
  waitFor,
} from './helpers.js';

// Defaults declared by the mysql template in src/core/templates.ts
const ROOT_PASSWORD = 'rootpassword';
const DB = 'database';

// mysql:8 ships the classic mysql client (unlike mariadb:11)
async function mysql(projectDir: string, service: string, sql: string) {
  return composeExec(projectDir, service, [
    'mysql',
    '-uroot',
    `-p${ROOT_PASSWORD}`,
    '-N',
    '-e',
    sql,
    DB,
  ]);
}

/**
 * MySQL earns its Tier 1 badge here: it reuses MariaDB's dump/replay logic but
 * with the mysql/mysqldump binaries the official image actually ships — the
 * exact divergence that broke MariaDB support in 0.8.x, verified from the
 * other direction.
 */
describe('mysql data lifecycle', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('mysql');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init and start bring up a healthy instance', async () => {
    const initResult = await runCli(['init', '-n', 'mys', '-e', 'mysql', '-y'], projectDir);
    expect(initResult.code).toBe(0);

    const startResult = await runCli(['start', 'mys'], projectDir, 300_000);
    expect(startResult.code).toBe(0);

    await waitFor(
      async () => (await mysql(projectDir, 'mys-db', 'SELECT 1;')).code === 0,
      'mys to accept connections',
      180_000,
    );
  });

  it('seed data is queryable', async () => {
    const create = await mysql(
      projectDir,
      'mys-db',
      'CREATE TABLE audit_check (id INT PRIMARY KEY); INSERT INTO audit_check VALUES (1), (2);',
    );
    expect(create.code).toBe(0);

    const count = await mysql(projectDir, 'mys-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });

  it('snapshot produces a SQL dump via mysqldump', async () => {
    const result = await runCli(['snapshot', 'mys'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'mys');
    expect(snapshot).toMatch(/\.sql$/);
  });

  it('restore recovers dropped data from the snapshot', async () => {
    const drop = await mysql(projectDir, 'mys-db', 'DROP TABLE audit_check;');
    expect(drop.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'mys');
    const result = await runCli(['restore', snapshot, '-t', 'mys', '--force'], projectDir, 300_000);
    expect(result.code).toBe(0);

    await waitFor(
      async () => (await mysql(projectDir, 'mys-db', 'SELECT 1;')).code === 0,
      'mys to accept connections after restore',
    );
    const count = await mysql(projectDir, 'mys-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });
});
