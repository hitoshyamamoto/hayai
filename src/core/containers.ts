import { spawn } from 'child_process';
import { getComposeFilePath } from './config.js';

// The compose service for an instance. Also its DNS name on the compose
// network, which is what container-to-container commands (e.g. redis MIGRATE)
// must use as a host.
export function composeServiceName(instanceName: string): string {
  return `${instanceName}-db`;
}

// Compose v2 names containers '<project>-<service>-<replica>', so a service
// name is NOT addressable by `docker exec`/`docker cp`. Every host-side data
// operation must resolve the real container through Compose first. `ps -aq`
// (not `-q`) so stopped containers resolve too — restore swaps files into a
// stopped Redis, for example.
export async function resolveServiceContainer(instanceName: string): Promise<string> {
  const composeFile = await getComposeFilePath();
  const service = composeServiceName(instanceName);

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn('docker', ['compose', '-f', composeFile, 'ps', '-aq', service], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data.toString()));
    child.stderr.on('data', (data) => (stderr += data.toString()));
    child.on('close', (code) => {
      code === 0
        ? resolve(stdout)
        : reject(new Error(`Failed to resolve container for '${instanceName}': ${stderr.trim()}`));
    });
    child.on('error', reject);
  });

  const containerId = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];

  if (!containerId) {
    throw new Error(
      `No container exists for instance '${instanceName}' — start it with: hayai start ${instanceName}`,
    );
  }

  return containerId;
}
