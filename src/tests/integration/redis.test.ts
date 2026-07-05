import {
  composeExec,
  createProject,
  destroyProject,
  latestSnapshot,
  runCli,
  waitFor,
} from './helpers.js';

async function redisCli(projectDir: string, service: string, cmd: string[]) {
  return composeExec(projectDir, service, ['redis-cli', ...cmd]);
}

/**
 * End-to-end data lifecycle for Redis: init → start → seed → snapshot (BGSAVE
 * + RDB copy) → flush → restore (stop, swap RDB, start) → verify.
 */
describe('redis data lifecycle', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('redis');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init and start bring up a healthy instance', async () => {
    const initResult = await runCli(['init', '-n', 'rd', '-e', 'redis', '-y'], projectDir);
    expect(initResult.code).toBe(0);

    const startResult = await runCli(['start', 'rd'], projectDir, 300_000);
    expect(startResult.code).toBe(0);

    await waitFor(
      async () => (await redisCli(projectDir, 'rd-db', ['ping'])).stdout.includes('PONG'),
      'rd to accept connections',
    );
  });

  it('seed data is readable', async () => {
    await redisCli(projectDir, 'rd-db', ['SET', 'audit:k1', 'v1']);
    await redisCli(projectDir, 'rd-db', ['SET', 'audit:k2', 'v2']);

    const get = await redisCli(projectDir, 'rd-db', ['GET', 'audit:k1']);
    expect(get.stdout.trim()).toBe('v1');
  });

  it('snapshot captures an RDB file', async () => {
    const result = await runCli(['snapshot', 'rd'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'rd');
    expect(snapshot).toMatch(/\.rdb$/);
  });

  it('restore recovers flushed keys from the RDB snapshot', async () => {
    await redisCli(projectDir, 'rd-db', ['FLUSHALL']);
    const empty = await redisCli(projectDir, 'rd-db', ['GET', 'audit:k1']);
    expect(empty.stdout.trim()).toBe('');

    const snapshot = await latestSnapshot(projectDir, 'rd');
    const result = await runCli(['restore', snapshot, '-t', 'rd', '--force'], projectDir, 300_000);
    expect(result.code).toBe(0);

    await waitFor(
      async () => (await redisCli(projectDir, 'rd-db', ['ping'])).stdout.includes('PONG'),
      'rd to accept connections after restore',
    );
    const restored = await redisCli(projectDir, 'rd-db', ['GET', 'audit:k1']);
    expect(restored.stdout.trim()).toBe('v1');
  });
});
