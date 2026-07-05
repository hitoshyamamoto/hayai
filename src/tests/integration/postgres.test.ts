import { readFile } from 'fs/promises';
import * as path from 'path';
import {
  composeExec,
  createProject,
  destroyProject,
  latestSnapshot,
  runCli,
  waitFor,
} from './helpers.js';

// Defaults declared by the postgresql template in src/core/templates.ts
const PG_USER = 'admin';
const PG_DB = 'database';

async function psql(projectDir: string, service: string, sql: string) {
  return composeExec(projectDir, service, ['psql', '-U', PG_USER, '-d', PG_DB, '-tAc', sql]);
}

async function waitForPostgres(projectDir: string, service: string) {
  await waitFor(
    async () =>
      (await composeExec(projectDir, service, ['pg_isready', '-U', PG_USER, '-d', PG_DB])).code ===
      0,
    `${service} to accept connections`,
  );
}

/**
 * End-to-end data lifecycle for PostgreSQL, the flagship Tier 1 engine:
 * init → start → seed → snapshot → destroy data → restore → clone → merge.
 * Every step drives the compiled CLI and verifies real data inside the
 * containers — this is the trust contract the audit demands.
 */
describe('postgresql data lifecycle', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('postgres');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init and start bring up a healthy instance', async () => {
    const initResult = await runCli(['init', '-n', 'pg', '-e', 'postgresql', '-y'], projectDir);
    expect(initResult.code).toBe(0);

    const startResult = await runCli(['start', 'pg'], projectDir, 300_000);
    expect(startResult.code).toBe(0);

    await waitForPostgres(projectDir, 'pg-db');
  });

  it('seed data is queryable through the published service', async () => {
    const create = await psql(
      projectDir,
      'pg-db',
      'CREATE TABLE audit_check (id int PRIMARY KEY); INSERT INTO audit_check VALUES (1), (2);',
    );
    expect(create.code).toBe(0);

    const count = await psql(projectDir, 'pg-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });

  it('snapshot produces a non-empty SQL dump of the real database', async () => {
    const result = await runCli(['snapshot', 'pg'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'pg');
    const dump = await readFile(path.join(projectDir, 'snapshots', snapshot), 'utf-8');
    expect(dump).toContain('audit_check');
  });

  it('restore recovers dropped data from the snapshot', async () => {
    const drop = await psql(projectDir, 'pg-db', 'DROP TABLE audit_check;');
    expect(drop.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'pg');
    const result = await runCli(['restore', snapshot, '-t', 'pg', '--force'], projectDir, 300_000);
    expect(result.code).toBe(0);

    await waitForPostgres(projectDir, 'pg-db');
    const count = await psql(projectDir, 'pg-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');
  });

  it('clone creates an independent instance with identical data', async () => {
    const result = await runCli(['clone', '-f', 'pg', '-t', 'pg-clone', '-y'], projectDir, 300_000);
    expect(result.code).toBe(0);

    await waitForPostgres(projectDir, 'pg-clone-db');
    const count = await psql(projectDir, 'pg-clone-db', 'SELECT count(*) FROM audit_check;');
    expect(count.stdout.trim()).toBe('2');

    // Independence: writing to the clone must not touch the source
    await psql(projectDir, 'pg-clone-db', 'INSERT INTO audit_check VALUES (3);');
    const sourceCount = await psql(projectDir, 'pg-db', 'SELECT count(*) FROM audit_check;');
    expect(sourceCount.stdout.trim()).toBe('2');
  });

  it('merge copies source rows into the target and leaves the source intact', async () => {
    const result = await runCli(
      ['merge', '-s', 'pg-clone', '-t', 'pg', '--execute', '--force'],
      projectDir,
      300_000,
    );
    expect(result.code).toBe(0);

    const targetCount = await psql(projectDir, 'pg-db', 'SELECT count(*) FROM audit_check;');
    expect(targetCount.stdout.trim()).toBe('3');

    const sourceCount = await psql(projectDir, 'pg-clone-db', 'SELECT count(*) FROM audit_check;');
    expect(sourceCount.stdout.trim()).toBe('3');
  });
});
