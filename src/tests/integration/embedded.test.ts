import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { createProject, destroyProject, latestSnapshot, parseListJson, runCli } from './helpers.js';

/**
 * End-to-end lifecycle for embedded (file-based) engines, using SQLite as the
 * representative: init → list → snapshot → corrupt → restore → clone → remove.
 * DuckDB, LevelDB and LMDB share the exact same host-file code paths.
 */
describe('embedded engine lifecycle (sqlite)', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('embedded');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init creates an embedded instance without a container or port', async () => {
    const result = await runCli(['init', '-n', 'emb', '-e', 'sqlite', '-y'], projectDir);
    expect(result.code).toBe(0);

    const instances = JSON.parse(
      await readFile(path.join(projectDir, 'data', 'instances.json'), 'utf-8'),
    );
    expect(instances.emb).toBeDefined();
    expect(instances.emb.status).toBe('embedded');
    expect(instances.emb.port).toBe(0);
  });

  it('list --format json reports the instance with machine-readable output', async () => {
    const result = await runCli(['list', '--format', 'json'], projectDir);
    expect(result.code).toBe(0);

    const instances = parseListJson(result);
    const emb = instances.find((instance) => instance.name === 'emb');
    expect(emb).toBeDefined();
    expect(emb?.engine).toBe('sqlite');
  });

  it('snapshot archives the data directory', async () => {
    await writeFile(path.join(projectDir, 'data', 'emb', 'emb.db'), 'generation-1');

    const result = await runCli(['snapshot', 'emb'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'emb');
    expect(snapshot).toMatch(/^emb-snapshot-.*\.tar\.gz$/);
  });

  it('restore returns the data directory to the snapshotted state', async () => {
    await writeFile(path.join(projectDir, 'data', 'emb', 'emb.db'), 'generation-2-corrupted');

    const snapshot = await latestSnapshot(projectDir, 'emb');
    const result = await runCli(['restore', snapshot, '-t', 'emb', '--force'], projectDir);
    expect(result.code).toBe(0);

    const content = await readFile(path.join(projectDir, 'data', 'emb', 'emb.db'), 'utf-8');
    expect(content).toBe('generation-1');
  });

  it('clone copies the data files to a new instance', async () => {
    const result = await runCli(['clone', '-f', 'emb', '-t', 'emb-copy', '-y'], projectDir);
    expect(result.code).toBe(0);

    const cloneDir = path.join(projectDir, 'data', 'emb-copy');
    const files = await readdir(cloneDir);
    expect(files.length).toBeGreaterThan(0);

    const contents = await Promise.all(
      files.map((file) => readFile(path.join(cloneDir, file), 'utf-8')),
    );
    expect(contents).toContain('generation-1');
  });

  it('remove deletes the instance and its data by default', async () => {
    const result = await runCli(['remove', 'emb-copy', '--force'], projectDir);
    expect(result.code).toBe(0);

    const listResult = await runCli(['list', '--format', 'json'], projectDir);
    const instances = parseListJson(listResult);
    expect(instances.find((instance) => instance.name === 'emb-copy')).toBeUndefined();

    await expect(readdir(path.join(projectDir, 'data', 'emb-copy'))).rejects.toThrow();
  });

  it('remove --keep-data preserves the data directory', async () => {
    await runCli(['clone', '-f', 'emb', '-t', 'emb-keep', '-y'], projectDir);
    const result = await runCli(['remove', 'emb-keep', '--force', '--keep-data'], projectDir);
    expect(result.code).toBe(0);

    const files = await readdir(path.join(projectDir, 'data', 'emb-keep'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('init refuses a duplicate instance name with a non-zero exit code', async () => {
    // mkdir keeps the failure path honest even if a previous test failed early
    await mkdir(path.join(projectDir, 'data', 'emb'), { recursive: true });
    const result = await runCli(['init', '-n', 'emb', '-e', 'sqlite', '-y'], projectDir);
    expect(result.code).not.toBe(0);
  });
});
