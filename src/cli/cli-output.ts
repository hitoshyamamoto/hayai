import chalk from 'chalk';
import { ExitCode, ExitCodeValue, emitFailure, emitSuccess } from '../core/output.js';
import { DockerNotReadyError } from '../core/docker.js';

// Shared failure path for every command: in --json mode the envelope goes to
// stdout (the machine channel) and the human hint to stderr; otherwise both go
// to stderr. Always exits with the semantic code from AUTOMATION.md.
export function fail(
  command: string,
  code: ExitCodeValue,
  message: string,
  jsonMode: boolean,
  hint?: string,
): never {
  if (jsonMode) {
    emitFailure(command, code, message);
  }
  console.error(chalk.red(`❌ ${message}`));
  if (hint) {
    console.error(chalk.yellow(`💡 ${hint}`));
  }
  process.exit(code);
}

// Maps thrown errors to the documented exit codes. Commands catch at the top
// level and route through here so unexpected failures still honor the
// contract (Environment for Docker being down, Error for everything else).
export function failFromError(command: string, error: unknown, jsonMode: boolean): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof DockerNotReadyError ? ExitCode.Environment : ExitCode.Error;
  fail(command, code, message, jsonMode);
}

export function succeed(command: string, data: unknown, jsonMode: boolean): void {
  if (jsonMode) {
    emitSuccess(command, data);
  }
}

export { ExitCode };
