import { mkdir, open, readFile, rm } from 'fs/promises';
import * as path from 'path';
import { getDataDirectory } from './config.js';

// Cross-process mutex over the local state files (instances.json,
// port-allocations.json, docker-compose.yml). Orchestrators retry tasks and
// run them concurrently; without this, two hayai processes interleave their
// read-modify-write cycles and silently drop instances from the inventory.
//
// Implementation: O_EXCL lock file in the data directory holding pid + start
// time. A lock older than STALE_MS, or whose pid is gone, is broken. This is
// advisory and single-host — exactly the scope of the state it protects.

const LOCK_FILE = '.hayai.lock';
const STALE_MS = 60_000;
const ACQUIRE_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 150;

interface LockInfo {
  pid: number;
  acquiredAt: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function tryBreakStaleLock(lockPath: string): Promise<void> {
  let info: LockInfo;
  try {
    info = JSON.parse(await readFile(lockPath, 'utf-8')) as LockInfo;
  } catch {
    // Unreadable or vanished — if it still exists it is corrupt; remove it.
    await rm(lockPath, { force: true }).catch(() => undefined);
    return;
  }

  const stale = Date.now() - info.acquiredAt > STALE_MS || !pidAlive(info.pid);
  if (stale) {
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function acquireStateLock(): Promise<() => Promise<void>> {
  const dataDir = await getDataDirectory();
  // First run in a fresh project: the data directory the lock lives in may
  // not exist yet.
  await mkdir(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, LOCK_FILE);
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;

  for (;;) {
    try {
      // 'wx' — O_CREAT | O_EXCL: creation is the atomic acquisition.
      const handle = await open(lockPath, 'wx');
      const info: LockInfo = { pid: process.pid, acquiredAt: Date.now() };
      await handle.writeFile(JSON.stringify(info));
      await handle.close();

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      await tryBreakStaleLock(lockPath);
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for the hayai state lock (${lockPath}). ` +
            'Another hayai process may be stuck; remove the file if you are sure none is running.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

// Convenience wrapper: run fn with the state lock held, always releasing.
export async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireStateLock();
  try {
    return await fn();
  } finally {
    await release();
  }
}
