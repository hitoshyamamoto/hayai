import { spawn } from 'child_process';
import { mkdtemp, readdir, rm } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Integration tests exercise the compiled CLI exactly as a user (or an
// orchestrator) would: a real child process, a real cwd, real Docker.
const CLI_PATH = path.resolve(process.cwd(), 'dist/cli/index.js');

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 180_000,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on('data', (data) => (stdout += data.toString()));
    child.stderr.on('data', (data) => (stderr += data.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export function runCli(args: string[], cwd: string, timeoutMs?: number): Promise<CliResult> {
  return run(process.execPath, [CLI_PATH, ...args], cwd, timeoutMs);
}

export function runDocker(args: string[], cwd: string, timeoutMs?: number): Promise<CliResult> {
  return run('docker', args, cwd, timeoutMs);
}

// Every hayai project writes its compose file to the cwd; exec through it so
// tests address services the same way Compose does, independent of how
// containers end up being named on the host.
export function composeExec(
  projectDir: string,
  service: string,
  cmd: string[],
  timeoutMs?: number,
): Promise<CliResult> {
  const composeFile = path.join(projectDir, 'docker-compose.yml');
  return runDocker(
    ['compose', '-f', composeFile, 'exec', '-T', service, ...cmd],
    projectDir,
    timeoutMs,
  );
}

export async function createProject(prefix: string): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), `hayai-it-${prefix}-`));
}

export async function destroyProject(projectDir: string): Promise<void> {
  const composeFile = path.join(projectDir, 'docker-compose.yml');
  // Best-effort teardown: the compose file may not exist if a suite failed early.
  await runDocker(
    ['compose', '-f', composeFile, 'down', '-v', '--remove-orphans'],
    projectDir,
  ).catch(() => undefined);
  try {
    await rm(projectDir, { recursive: true, force: true });
  } catch {
    // Containers write into the bind mount as root, so the host user cannot
    // unlink those files. Scrub through a throwaway container instead; never
    // let cleanup failures mask the actual test outcome.
    await runDocker(
      [
        'run',
        '--rm',
        '-v',
        `${projectDir}:/target`,
        'alpine:latest',
        'sh',
        '-c',
        'rm -rf /target/* /target/.[!.]* 2>/dev/null || true',
      ],
      projectDir,
    ).catch(() => undefined);
    await rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function waitFor(
  probe: () => Promise<boolean>,
  label: string,
  timeoutMs = 120_000,
  intervalMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for: ${label}` +
      (lastError ? `\nlast error: ${lastError}` : ''),
  );
}

// Snapshot filenames embed an ISO timestamp with ':' and '.' replaced by '-',
// so lexicographic order within one instance prefix is chronological order.
export async function latestSnapshot(projectDir: string, instanceName: string): Promise<string> {
  const snapshotsDir = path.join(projectDir, 'snapshots');
  const files = await readdir(snapshotsDir);
  const matching = files.filter((file) => file.startsWith(`${instanceName}-snapshot-`)).sort();
  if (matching.length === 0) {
    throw new Error(`No snapshot found for '${instanceName}' in ${snapshotsDir}`);
  }
  return matching[matching.length - 1];
}

export function parseListJson(result: CliResult): Array<Record<string, unknown>> {
  return JSON.parse(result.stdout) as Array<Record<string, unknown>>;
}
