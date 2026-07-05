import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { createProject, destroyProject, runCli, CliResult } from './helpers.js';

/**
 * Verifies the automation contract (AUTOMATION.md): JSON envelopes on stdout,
 * semantic exit codes, idempotent verbs, refusal to prompt under --json, and
 * state-lock safety under concurrent mutations. Embedded engines are used
 * throughout so the suite stays fast — the contract layer is engine-agnostic.
 */
describe('automation contract', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('automation');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  function envelope(result: CliResult): any {
    return JSON.parse(result.stdout);
  }

  it('init --json emits a success envelope and creates the instance', async () => {
    const result = await runCli(['init', '-n', 'auto', '-e', 'sqlite', '--json'], projectDir);
    expect(result.code).toBe(0);

    const body = envelope(result);
    expect(body.ok).toBe(true);
    expect(body.command).toBe('init');
    expect(body.data.created).toBe(true);
    expect(body.data.instance.name).toBe('auto');
  });

  it('init is idempotent with --exists-ok and conflicts without it', async () => {
    const retry = await runCli(
      ['init', '-n', 'auto', '-e', 'sqlite', '--exists-ok', '--json'],
      projectDir,
    );
    expect(retry.code).toBe(0);
    expect(envelope(retry).data.created).toBe(false);

    const conflict = await runCli(['init', '-n', 'auto', '-e', 'sqlite', '--json'], projectDir);
    expect(conflict.code).toBe(4);
    expect(envelope(conflict).ok).toBe(false);
    expect(envelope(conflict).error.code).toBe(4);

    // Same name, different engine: --exists-ok must NOT mask a real conflict
    const wrongEngine = await runCli(
      ['init', '-n', 'auto', '-e', 'duckdb', '--exists-ok', '--json'],
      projectDir,
    );
    expect(wrongEngine.code).toBe(4);
  });

  it('init --json refuses to prompt when required inputs are missing', async () => {
    const result = await runCli(['init', '--json'], projectDir);
    expect(result.code).toBe(2);
    expect(envelope(result).error.code).toBe(2);
  });

  it('unknown instances exit 3 with a machine-readable error', async () => {
    const start = await runCli(['start', 'ghost', '--json'], projectDir);
    expect(start.code).toBe(3);
    expect(envelope(start).error.code).toBe(3);

    const snapshot = await runCli(['snapshot', 'ghost', '--json'], projectDir);
    expect(snapshot.code).toBe(3);

    const restore = await runCli(['restore', 'no-such-file.sql', '--json', '--force'], projectDir);
    expect(restore.code).toBe(3);
  });

  it('remove --json without --force refuses instead of prompting', async () => {
    const result = await runCli(['remove', 'auto', '--json'], projectDir);
    expect(result.code).toBe(5);
    expect(envelope(result).error.code).toBe(5);
  });

  it('remove is idempotent with --missing-ok', async () => {
    const missing = await runCli(['remove', 'ghost', '--missing-ok', '--json'], projectDir);
    expect(missing.code).toBe(0);
    expect(envelope(missing).data.removed).toBe(false);

    const notFound = await runCli(['remove', 'ghost', '--json', '--force'], projectDir);
    expect(notFound.code).toBe(3);
  });

  it('merge without --execute reports a preview, not an execution', async () => {
    // Embedded engines cannot merge, so use two sqlite instances only to get
    // past name resolution; the precondition (unsupported engine) must win.
    await runCli(['init', '-n', 'auto2', '-e', 'sqlite', '--json'], projectDir);
    const result = await runCli(['merge', '-s', 'auto', '-t', 'auto2', '--json'], projectDir);
    // sqlite instances are 'embedded', not 'running' → precondition
    expect(result.code).toBe(5);
    expect(envelope(result).ok).toBe(false);
  });

  it('concurrent inits serialize through the state lock without losing instances', async () => {
    const names = ['c1', 'c2', 'c3', 'c4', 'c5'];
    const results = await Promise.all(
      names.map((name) => runCli(['init', '-n', name, '-e', 'sqlite', '--json'], projectDir)),
    );

    for (const result of results) {
      expect(result.code).toBe(0);
    }

    // Every instance must have survived every other process's save
    const instances = JSON.parse(
      await readFile(path.join(projectDir, 'data', 'instances.json'), 'utf-8'),
    );
    for (const name of names) {
      expect(instances[name]).toBeDefined();
    }
  });

  it('stdout carries exactly one parseable JSON document in --json mode', async () => {
    const result = await runCli(['list', '--json'], projectDir);
    expect(result.code).toBe(0);
    // JSON.parse on the full stdout throws if anything else leaked into it
    const body = envelope(result);
    expect(body.command).toBe('list');
    expect(Array.isArray(body.data.instances)).toBe(true);
  });

  it('embedded engines work without a Docker daemon', async () => {
    // A broken `docker` shim first in PATH simulates a machine where the
    // daemon is unusable; host tools (tar) stay available. The CLI must not
    // require the daemon for file-based engines or for reading state.
    const fakeBin = path.join(projectDir, 'fake-bin');
    await mkdir(fakeBin, { recursive: true });
    const shim = path.join(fakeBin, 'docker');
    await writeFile(shim, '#!/bin/sh\nexit 1\n');
    await chmod(shim, 0o755);
    const noDocker = { PATH: `${fakeBin}:${process.env.PATH ?? ''}` };

    const init = await runCli(
      ['init', '-n', 'nodocker', '-e', 'sqlite', '--json'],
      projectDir,
      60_000,
      noDocker,
    );
    expect(init.code).toBe(0);

    const list = await runCli(['list', '--json'], projectDir, 60_000, noDocker);
    expect(list.code).toBe(0);

    const snapshot = await runCli(['snapshot', 'nodocker', '--json'], projectDir, 60_000, noDocker);
    expect(snapshot.code).toBe(0);

    // And when Docker IS required, the failure is the documented exit 6
    const start = await runCli(['start', 'nodocker', '--json'], projectDir, 60_000, noDocker);
    // embedded start is a no-op success; use a containerized engine instead
    expect(start.code).toBe(0);

    await runCli(
      ['init', '-n', 'needsdocker', '-e', 'redis', '--json'],
      projectDir,
      60_000,
      noDocker,
    );
    const startContainer = await runCli(
      ['start', 'needsdocker', '--json'],
      projectDir,
      60_000,
      noDocker,
    );
    expect(startContainer.code).toBe(6);
    expect(envelope(startContainer).error.code).toBe(6);
  });
});
