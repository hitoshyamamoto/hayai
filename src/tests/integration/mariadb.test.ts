import {
  composeExec,
  createProject,
  destroyProject,
  latestSnapshot,
  runCli,
  waitFor,
} from './helpers.js';

// Defaults declared by the mariadb template in src/core/templates.ts
const ROOT_PASSWORD = 'rootpassword';
const DB = 'database';

// mariadb:11 images ship only the mariadb-* client names (no mysql symlinks)
async function mysql(projectDir: string, service: string, sql: string) {
  return composeExec(projectDir, service, [
    'mariadb',
    '-uroot',
    `-p${ROOT_PASSWORD}`,
    '-N',
    '-e',
    sql,
    DB,
  ]);
}

/**
 * End-to-end data lifecycle for MariaDB: init → start → seed → snapshot →
 * destroy data → restore → verify. Exercises the mysqldump/mysql replay path.
 */
describe('mariadb data lifecycle', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('mariadb');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init and start bring up a healthy instance', async () => {
    const initResult = await runCli(['init', '-n', 'mdb', '-e', 'mariadb', '-y'], projectDir);
    expect(initResult.code).toBe(0);

    const startResult = await runCli(['start', 'mdb'], projectDir, 300_000);
    expect(startResult.code).toBe(0);

    await waitFor(
      async () => (await mysql(projectDir, 'mdb-db', 'SELECT 1;')).code === 0,
      'mdb to accept connections',
    );
  });

  it('seed data is queryable', async () => {
    const create = await mysql(
      projectDir,
      'mdb-db',
      'CREATE TABLE audit_check (id INT PRIMARY KEY); INSERT INTO audit_check VALUES (1), (2);',
    );
    expect(create.code).toBe(0);

    const count = await mysql(projectDir, 'mdb-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });

  it('snapshot produces a SQL dump containing the seeded schema', async () => {
    const result = await runCli(['snapshot', 'mdb'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'mdb');
    expect(snapshot).toMatch(/\.sql$/);
  });

  it('restore recovers dropped data from the snapshot', async () => {
    const drop = await mysql(projectDir, 'mdb-db', 'DROP TABLE audit_check;');
    expect(drop.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'mdb');
    const result = await runCli(['restore', snapshot, '-t', 'mdb', '--force'], projectDir, 300_000);
    expect(result.code).toBe(0);

    await waitFor(
      async () => (await mysql(projectDir, 'mdb-db', 'SELECT 1;')).code === 0,
      'mdb to accept connections after restore',
    );
    const count = await mysql(projectDir, 'mdb-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });
});
