import {
  composeExec,
  createProject,
  destroyProject,
  latestSnapshot,
  runCli,
  waitFor,
} from './helpers.js';

// Defaults declared by the timescaledb template in src/core/templates.ts
const PG_USER = 'admin';
const PG_DB = 'hayai_db';

async function psql(projectDir: string, service: string, sql: string) {
  return composeExec(projectDir, service, ['psql', '-U', PG_USER, '-d', PG_DB, '-tAc', sql]);
}

/**
 * TimescaleDB earns its Tier 1 badge here: although it shares PostgreSQL's
 * pg_dump/psql code paths, the image, extension bootstrap and default
 * database differ — so the cycle is verified against the real image, not
 * assumed by analogy.
 */
describe('timescaledb data lifecycle', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('timescale');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init and start bring up a healthy instance with the timescaledb extension', async () => {
    const initResult = await runCli(['init', '-n', 'tsdb', '-e', 'timescaledb', '-y'], projectDir);
    expect(initResult.code).toBe(0);

    const startResult = await runCli(['start', 'tsdb'], projectDir, 300_000);
    expect(startResult.code).toBe(0);

    await waitFor(
      async () =>
        (await composeExec(projectDir, 'tsdb-db', ['pg_isready', '-U', PG_USER, '-d', PG_DB]))
          .code === 0,
      'tsdb to accept connections',
    );

    const extension = await psql(
      projectDir,
      'tsdb-db',
      "SELECT count(*) FROM pg_extension WHERE extname = 'timescaledb';",
    );
    expect(extension.stdout.trim()).toBe('1');
  });

  it('seed data is queryable', async () => {
    const create = await psql(
      projectDir,
      'tsdb-db',
      'CREATE TABLE audit_check (id int PRIMARY KEY); INSERT INTO audit_check VALUES (1), (2);',
    );
    expect(create.code).toBe(0);

    const count = await psql(projectDir, 'tsdb-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });

  it('snapshot produces a SQL dump of the real database', async () => {
    const result = await runCli(['snapshot', 'tsdb'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'tsdb');
    expect(snapshot).toMatch(/\.sql$/);
  });

  it('restore recovers dropped data from the snapshot', async () => {
    const drop = await psql(projectDir, 'tsdb-db', 'DROP TABLE audit_check;');
    expect(drop.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'tsdb');
    const result = await runCli(
      ['restore', snapshot, '-t', 'tsdb', '--force'],
      projectDir,
      300_000,
    );
    expect(result.code).toBe(0);

    await waitFor(
      async () =>
        (await composeExec(projectDir, 'tsdb-db', ['pg_isready', '-U', PG_USER, '-d', PG_DB]))
          .code === 0,
      'tsdb to accept connections after restore',
    );
    const count = await psql(projectDir, 'tsdb-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });
});
