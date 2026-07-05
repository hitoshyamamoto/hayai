// Semantic exit codes — the contract an orchestrator scripts against.
// Documented in AUTOMATION.md; changing a value is a breaking change.
export const ExitCode = {
  // The operation completed (including honest no-ops like `init --exists-ok`
  // on an existing instance).
  Success: 0,
  // Unexpected failure: bugs, I/O errors, anything without a more specific
  // code. Retrying may or may not help.
  Error: 1,
  // The invocation itself is invalid (unknown command, bad flag combination).
  // Retrying the same invocation will never help.
  Usage: 2,
  // The named resource (instance, snapshot) does not exist.
  NotFound: 3,
  // The resource already exists and the operation refuses to overwrite it.
  Conflict: 4,
  // The resource exists but is in the wrong state for this operation
  // (not running, unsupported engine, cross-engine pair, missing --execute).
  Precondition: 5,
  // The environment cannot run the operation (Docker missing or not running,
  // Compose plugin absent).
  Environment: 6,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
