import { createProject, destroyProject, runCli } from './helpers.js';

/**
 * `hayai env` — the inventory-to-environment bridge (Airflow pattern 2).
 * Instances only need to exist, not run, so no containers are started here.
 */
describe('env command', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('env');
    for (const [name, engine] of [
      ['pg', 'postgresql'],
      ['cache', 'redis'],
      ['emb', 'sqlite'],
      ['vec', 'qdrant'],
    ]) {
      const result = await runCli(['init', '-n', name, '-e', engine, '--json'], projectDir);
      expect(result.code).toBe(0);
    }
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('shell format emits eval-able export lines for every instance', async () => {
    const result = await runCli(['env'], projectDir);
    expect(result.code).toBe(0);

    const lines = result.stdout.trim().split('\n');
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).toMatch(/^export [A-Z0-9_]+_DB_URL='[^']+'$/);
    }
    expect(result.stdout).toContain('export PG_DB_URL=');
    expect(result.stdout).toContain('export EMB_DB_URL=');
  });

  it('dotenv format emits KEY=VALUE without export', async () => {
    const result = await runCli(['env', '--format', 'dotenv'], projectDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('CACHE_DB_URL=redis://localhost:');
    expect(result.stdout).not.toContain('export ');
  });

  it('airflow format maps known connection types and skips the rest loudly', async () => {
    const result = await runCli(['env', '--format', 'airflow'], projectDir);
    expect(result.code).toBe(0);

    // postgres:// (Airflow conn type), not postgresql://
    expect(result.stdout).toMatch(/^AIRFLOW_CONN_PG=postgres:\/\//m);
    expect(result.stdout).toMatch(/^AIRFLOW_CONN_CACHE=redis:\/\//m);

    // No Airflow connection type for sqlite-as-file or qdrant → skipped, on
    // stderr only, so sourcing stdout stays safe
    expect(result.stdout).not.toContain('AIRFLOW_CONN_EMB');
    expect(result.stdout).not.toContain('AIRFLOW_CONN_VEC');
    expect(result.stderr).toContain("Skipped 'emb'");
    expect(result.stderr).toContain("Skipped 'vec'");
  });

  it('--json returns the variables and the skipped list in the envelope', async () => {
    const result = await runCli(['env', '--format', 'airflow', '--json'], projectDir);
    expect(result.code).toBe(0);

    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(true);
    expect(body.command).toBe('env');
    expect(Object.keys(body.data.variables)).toEqual(
      expect.arrayContaining(['AIRFLOW_CONN_PG', 'AIRFLOW_CONN_CACHE']),
    );
    expect(body.data.skipped.map((s: { name: string }) => s.name).sort()).toEqual(['emb', 'vec']);
  });

  it('rejects an unknown format with the Usage exit code', async () => {
    const result = await runCli(['env', '--format', 'toml', '--json'], projectDir);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).error.code).toBe(2);
  });
});
