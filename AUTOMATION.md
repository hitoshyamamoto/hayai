# Automation Contract

Hayai is built to be driven by orchestrators — an Airflow DAG, a systemd
timer, a CI job, a shell script. This document is the contract those callers
script against. Everything here is stable within a major version; changing an
exit code value or an envelope field is a breaking change.

## The five guarantees

1. **`--json` output with a stable schema** on every state-changing verb.
2. **Semantic exit codes** — retry decisions can be made from the code alone.
3. **Idempotent verbs** — retrying a succeeded task does not fail it.
4. **No prompts in `--json` mode** — a missing confirmation fails fast with a
   code, never hangs waiting for input.
5. **Locked state** — concurrent hayai processes cannot corrupt the local
   inventory (`data/instances.json`, `data/port-allocations.json`,
   `docker-compose.yml`).

## Exit codes

| Code | Name         | Meaning                                                                 | Retry?                        |
|------|--------------|-------------------------------------------------------------------------|-------------------------------|
| 0    | Success      | Operation completed (including honest no-ops like `--exists-ok`)        | —                             |
| 1    | Error        | Unexpected failure (bug, I/O, engine tooling failed)                    | Maybe                         |
| 2    | Usage        | Invalid invocation (bad flags, unsupported engine name)                 | Never — fix the call          |
| 3    | NotFound     | Named instance or snapshot does not exist                               | Never — fix the reference     |
| 4    | Conflict     | Resource already exists and the verb refuses to overwrite               | Never — use the idempotency flag |
| 5    | Precondition | Resource exists but is in the wrong state (not running, unsupported engine, missing `--execute`/`--force`) | After fixing the state        |
| 6    | Environment  | Docker missing, daemon down, or Compose V2 plugin absent                | After fixing the environment  |

## The `--json` envelope

Verbs with `--json` print exactly one JSON document to **stdout**. All human
chatter (banner, spinners, hints) goes to **stderr**.

```json
{
  "ok": true,
  "command": "init",
  "data": { "created": true, "instance": { "name": "mydb", "engine": "postgresql", "port": 5000 } }
}
```

On failure:

```json
{
  "ok": false,
  "command": "restore",
  "error": { "code": 3, "message": "Snapshot file not found: nope.sql" }
}
```

`data` may appear alongside `error` when partial results exist (e.g. which
databases a `sync` created before failing).

Supported: `init`, `start`, `stop`, `remove`, `snapshot`, `restore`, `clone`,
`merge`, `sync`, `export`, `list`.

Two documented exceptions keep their historical raw shapes:
- `list --format json` — the raw instance array (predates the envelope).
- `connect --json` — the raw ConnectionInfo object; `connect --uri` prints
  only the URI.

## Idempotency

| Verb    | Flag           | Behavior on retry                                                        |
|---------|----------------|--------------------------------------------------------------------------|
| `init`  | `--exists-ok`  | Instance exists with the same engine → exit 0, `data.created: false`. Different engine → exit 4. |
| `remove`| `--missing-ok` | Instance absent → exit 0, `data.removed: false`.                          |
| `start` | (default)      | Starting a running instance is a no-op success (Compose semantics).       |
| `stop`  | (default)      | Stopping a stopped instance is a no-op success.                           |
| `sync`  | (default)      | Additive by design: existing instances are skipped, never modified.       |

## Non-interactive mode

`--json` disables every prompt. Where a confirmation would be required
(`remove`, `restore`, `clone`, `merge --execute`), pass the documented skip
flag (`--force` / `-y`); otherwise the command exits 5 with a message naming
the flag. `init --json` requires `--name` and `--engine` (exit 2 otherwise).

## Concurrency

Every state mutation takes an advisory lock (`data/.hayai.lock`) and re-reads
the state inside it, so concurrent `init`/`remove`/`start`/`stop` calls from
parallel tasks serialize correctly. Locks held by dead processes, or older
than 60 s, are broken automatically; acquisition times out after 30 s with
exit 1.

## Docker requirements

Docker is verified lazily, on the first operation that talks to the daemon.
`init`, `list`, `connect`, `export` and every operation on embedded engines
(sqlite, duckdb, leveldb, lmdb) work with no Docker daemon at all. When Docker
is required and unavailable, commands exit 6.

## Recipes

```bash
# Idempotent provision inside a retried task
hayai init -n staging -e postgresql --exists-ok --json

# Gate on state, not on text parsing
hayai snapshot staging --json || case $? in
  3) echo "instance gone";;
  5) echo "instance not running";;
  6) echo "docker down";;
esac

# Ephemeral database per pipeline run
hayai init -n "ci-$BUILD_ID" -e postgresql --exists-ok --json
hayai start "ci-$BUILD_ID" --json
# ... run the tests ...
hayai remove "ci-$BUILD_ID" --force --missing-ok --json

# Export the connection for the app under test
export DATABASE_URL=$(hayai connect "ci-$BUILD_ID" --uri)
```
