# Testing

Two suites, two jobs, one rule: **a green badge means the verbs work, not
merely that the code compiles.**

## Unit tests — `npm test`

Fast, Docker-free, run on Node 22 and 24 in CI (`jest.config.cjs`; the
integration directory is excluded via `testPathIgnorePatterns`).

- `unit/templates.test.ts` — the engine catalog: 22 templates, structural
  validity, counts per type, the experimental set (`milvus`, `nebula`,
  `tikv`), and the Tier 1 set. The tier test is intentionally strict: an
  engine joins Tier 1 only together with its end-to-end coverage.
- `unit/connect.test.ts` — `buildConnectionInfo` (pure function).

## Integration tests — `npm run test:integration`

The heart of the trust contract (`jest.integration.config.cjs`: serial
workers, 300 s timeouts, builds first so the compiled artifact is what gets
tested). Requires a running Docker daemon; CI runs the suite on every push and
PR in the `Integration (Tier 1 engines)` job.

Every test drives `dist/cli/index.js` as a real child process with an isolated
temp-dir cwd — the exact way a CI job or an orchestrator consumes hayai.

| File | What it proves |
|---|---|
| `postgres.test.ts` | Full cycle: init → start → seed → snapshot → drop → restore → verify, plus clone independence and merge semantics |
| `timescaledb.test.ts` | Same dump/restore cycle against the real timescale image (extension present) |
| `mariadb.test.ts` | The `mariadb-dump`/`mariadb` replay path |
| `redis.test.ts` | BGSAVE snapshot, FLUSHALL, stopped-target RDB swap restore |
| `embedded.test.ts` | SQLite as representative of the host-file engines: snapshot/restore/clone/remove, `--keep-data`, duplicate-name refusal |
| `automation.test.ts` | Everything AUTOMATION.md promises: envelopes, exit codes 2–6, `--exists-ok`/`--missing-ok`, prompt refusal under `--json`, concurrent-init lock safety, the no-Docker matrix |

`helpers.ts` is the only plumbing: `runCli` (with env overrides for the
no-Docker tests), `composeExec` (address services through Compose, never by
guessed container names), `waitFor`, `latestSnapshot`, and `destroyProject`
(which reaps root-owned bind-mount files through a throwaway container).

## Philosophy

- **No mocked Docker.** The 0.8.x container-addressing bug survived precisely
  because nothing ever talked to a real daemon. Integration tests exercise
  real images, real data, real failure modes.
- **Tests are the tier system.** The README support matrix and the
  `getEngineTier` API are backed by what this directory actually verifies.
  Extending Tier 1 = adding the engine's cycle here first.
- **Assert outcomes, not output text.** Tests check exit codes, JSON
  envelopes, and data inside the containers — never spinner text or emoji.

## Running locally

```bash
npm test                    # unit only, no Docker needed
npm run test:integration    # needs Docker; pulls small images on first run
npm run test:coverage       # unit coverage
```

The scripts `test:cli` and `test:database` in package.json are reserved for
future suites; their directories do not exist yet.
