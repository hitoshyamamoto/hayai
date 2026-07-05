import {
  composeExec,
  createProject,
  destroyProject,
  latestSnapshot,
  runCli,
  waitFor,
} from './helpers.js';

// valkey-cli is the binary the image guarantees; redis-cli symlinks are not
// relied upon anywhere.
async function valkeyCli(projectDir: string, service: string, cmd: string[]) {
  return composeExec(projectDir, service, ['valkey-cli', ...cmd]);
}

/**
 * Valkey (the Linux Foundation Redis fork) earns its Tier 1 badge here: same
 * BGSAVE/RDB-swap flow as Redis, but through valkey-cli and the valkey image.
 */
describe('valkey data lifecycle', () => {
  let projectDir: string;

  beforeAll(async () => {
    projectDir = await createProject('valkey');
  });

  afterAll(async () => {
    await destroyProject(projectDir);
  });

  it('init and start bring up a healthy instance', async () => {
    const initResult = await runCli(['init', '-n', 'vk', '-e', 'valkey', '-y'], projectDir);
    expect(initResult.code).toBe(0);

    const startResult = await runCli(['start', 'vk'], projectDir, 300_000);
    expect(startResult.code).toBe(0);

    await waitFor(
      async () => (await valkeyCli(projectDir, 'vk-db', ['ping'])).stdout.includes('PONG'),
      'vk to accept connections',
    );
  });

  it('seed data is readable', async () => {
    await valkeyCli(projectDir, 'vk-db', ['SET', 'audit:k1', 'v1']);
    await valkeyCli(projectDir, 'vk-db', ['SET', 'audit:k2', 'v2']);

    const get = await valkeyCli(projectDir, 'vk-db', ['GET', 'audit:k1']);
    expect(get.stdout.trim()).toBe('v1');
  });

  it('snapshot captures an RDB file', async () => {
    const result = await runCli(['snapshot', 'vk'], projectDir);
    expect(result.code).toBe(0);

    const snapshot = await latestSnapshot(projectDir, 'vk');
    expect(snapshot).toMatch(/\.rdb$/);
  });

  it('restore recovers flushed keys from the RDB snapshot', async () => {
    await valkeyCli(projectDir, 'vk-db', ['FLUSHALL']);
    const empty = await valkeyCli(projectDir, 'vk-db', ['GET', 'audit:k1']);
    expect(empty.stdout.trim()).toBe('');

    const snapshot = await latestSnapshot(projectDir, 'vk');
    const result = await runCli(['restore', snapshot, '-t', 'vk', '--force'], projectDir, 300_000);
    expect(result.code).toBe(0);

    await waitFor(
      async () => (await valkeyCli(projectDir, 'vk-db', ['ping'])).stdout.includes('PONG'),
      'vk to accept connections after restore',
    );
    const restored = await valkeyCli(projectDir, 'vk-db', ['GET', 'audit:k1']);
    expect(restored.stdout.trim()).toBe('v1');
  });
});
