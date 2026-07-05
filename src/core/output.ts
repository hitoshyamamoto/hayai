import { ExitCode, ExitCodeValue } from './exit-codes.js';

// Machine-readable envelope for --json mode. The shape is part of the
// automation contract (AUTOMATION.md): stdout carries exactly one JSON
// document; human-facing chatter goes to stderr.
export interface JsonEnvelope {
  ok: boolean;
  command: string;
  // Present on success; on failure it may carry partial results (e.g. which
  // databases a sync did manage to create before erroring).
  data?: unknown;
  error?: {
    code: ExitCodeValue;
    message: string;
  };
}

export function emitSuccess(command: string, data?: unknown): void {
  const envelope: JsonEnvelope = { ok: true, command };
  if (data !== undefined) {
    envelope.data = data;
  }
  console.log(JSON.stringify(envelope, null, 2));
}

// Prints the error envelope to stdout (the machine channel) and returns the
// exit code so callers can `process.exit(emitFailure(...))`.
export function emitFailure(
  command: string,
  code: ExitCodeValue,
  message: string,
  data?: unknown,
): ExitCodeValue {
  const envelope: JsonEnvelope = {
    ok: false,
    command,
    error: { code, message },
  };
  if (data !== undefined) {
    envelope.data = data;
  }
  console.log(JSON.stringify(envelope, null, 2));
  return code;
}

export { ExitCode };
export type { ExitCodeValue };
