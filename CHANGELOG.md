# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- End-to-end integration suite (`npm run test:integration`): the full
  init → start → seed → snapshot → destroy → restore cycle (plus clone and
  merge where supported) runs against real containers for every Tier 1 engine,
  on every push, in CI.
- Automation contract, documented in `AUTOMATION.md`: `--json` envelopes with a
  stable schema on all state-changing verbs, semantic exit codes (0–6),
  idempotency flags (`init --exists-ok`, `remove --missing-ok`), guaranteed
  non-interactivity under `--json`, and an advisory lock serializing all local
  state mutations across concurrent hayai processes.
- Engine tier system (`getEngineTier`): Tier 1 (postgresql, timescaledb,
  mariadb, redis, sqlite, duckdb, leveldb, lmdb) has every data verb verified
  by CI; Tier 2 provisions fine but its data verbs are best-effort. The README
  support matrix states exactly what each engine gets.

### Fixed
- All data commands (`snapshot`, `restore`, `clone`, `merge`) addressed
  containers by a name Compose never assigns (`<name>-db`), so they failed for
  every containerized engine. Containers are now resolved through
  `docker compose ps`.
- MariaDB data commands invoked `mysql`/`mysqldump`, which no longer exist in
  the `mariadb:11` image; they now use `mariadb`/`mariadb-dump`.
- Redis clone copied the RDB into a running target, which overwrote it with its
  own dataset on shutdown; the copy now happens with the target stopped.
- PostgreSQL merge lost the entire table's data on the first key conflict
  (all-or-nothing COPY); it now merges row-by-row and documents the real
  conflict semantics (target wins; Redis: source wins).
- `list --format json` stdout was corrupted by the Docker status banner; all
  human chatter now goes to stderr.
- `tikv` and `nebula` generated broken compose services (alpine image, wrong
  port) because the engine data in `docker.ts` had drifted from the template
  catalog; `templates.ts` is now the single source those values are read from.
- Compose services now actually join the configured `network_name`; the
  networks block used to be declared but never referenced.
- Docker is verified lazily: `init`, `list`, `connect`, `export` and all
  embedded-engine operations work without a Docker daemon, and commands that do
  need it fail with the documented Environment exit code instead of a generic
  exit 1.

### Changed
- Removed the decorative `REDIS_PASSWORD` template variable — the official
  image ignores it, and the connection URI promised authentication that never
  existed. Redis instances are unauthenticated, consistent with the documented
  local-dev threat model.
- Removed the never-implemented `sync --force` flag; `sync` is additive by
  design. `start`/`stop` `--all` now works as the explicit form of omitting the
  instance name.

## [0.8.0] - 2026-06-22

A large pass that makes the commands do what they claim, hardens the toolchain
and release pipeline, and modernizes the dependency stack.

### Added
- `hayai restore <snapshot>` closes the snapshot loop: replays SQL dumps
  (PostgreSQL, TimescaleDB, MariaDB), swaps the RDB for Redis, and extracts the
  data directory for embedded engines. Snapshot-only engines are refused with
  pointers to their native restore tooling.
- `hayai connect <name>` prints an instance's connection details. `--uri` emits
  just the URI for scripting (`export DATABASE_URL=$(hayai connect mydb --uri)`)
  and `--json` emits the structured form.
- Audit logging is enforced: `clone`, `merge`, `snapshot`, `restore`, and
  `remove` append to `.hayai/audit.log` when `auditOperations` is enabled
  (default), so `hayai security --audit` reflects real activity.
- `init` warns when an engine is experimental. TiKV, Milvus, and NebulaGraph are
  flagged: hayai runs them as a single container, but they need a multi-node
  cluster to be dependable.
- A typed programmatic entry point (`main`/`types`/`exports` and `src/index.ts`),
  so `hayai-db` exposes the engine catalog, types, and managers as a library —
  and the previously dangling `main` now resolves.
- CI runs lint, a format check, a Node 22/24 test matrix, a compiled-CLI smoke
  test, a packaging dry-run, and a dependency audit, with every action pinned by
  commit SHA. Added CodeQL (`security-and-quality`) and grouped Dependabot.

### Changed
- **Requires Node.js 22.13+** (0.7.1 required 18). Node 18 and 20 are both
  end-of-life and the runtime dependency updates below need Node 22+.
- Update runtime dependencies: `commander` 12 → 15, `inquirer` 9 → 14 (drops the
  obsolete `@types/inquirer`), `ora` 8 → 9, `chalk` 5.4 → 5.6. `clone`'s
  multi-target flag is now `--tm` (was `-tm`) — commander 15 rejects
  multi-character short flags.
- Update tooling: ESLint 8 → 10 on flat config, Jest 29 → 30, Prettier added and
  enforced in CI, plus the supporting `@types`/tsx packages. TypeScript stays on
  5.x until typescript-eslint supports 6.
- The decorative banner now prints to stderr, so data commands keep stdout clean
  and pipeable (`connect --uri`, `list --format json`).
- `merge --backup-both` now actually snapshots both databases before the merge
  and aborts if either backup fails.
- Release workflow split into build → publish → GitHub Release. The tarball that
  passes tests is the one published; the GitHub Release notes are cut from this
  changelog, and the tag is checked against `package.json` before anything ships.

### Removed
- `merge` no longer falls back to a file-level "generic merge" that archived one
  container's `/data` over another's filesystem. Cross-engine and unsupported
  pairs are refused instead of silently corrupting the target.

### Security
- `.hayai/` (audit log, policy, encrypted credential store, and its key) is
  gitignored. The credential encryption key is created on first use rather than
  on startup, so audit-only runs don't drop a `.key`.

## [0.7.1] - 2026-06-12

First release tracked in this changelog. This line of work was a deliberate pass
to make every command do what it claims — and say so plainly when it does not.

### Changed
- Embedded engines (SQLite, DuckDB, LevelDB, LMDB) are managed as host files
  instead of containers, so clone and snapshot operate at the filesystem level.
- Docker integration targets the Compose V2 plugin (`docker compose`).
- `merge` is documented and treated as a one-way source-into-target operation
  and now requires `--execute` to run.
- `clone`, `merge`, and `snapshot` derive credentials from each instance's own
  environment rather than assuming defaults.

### Fixed
- `merge` transfers Redis keys natively (`MIGRATE … COPY REPLACE`) instead of
  piping `DUMP` output through a text pipeline that corrupted binary values.
- `logs` streams real container output.
- `snapshot list` reports real timestamps and formats.
- `remove` honors `--keep-data`.

### Removed
- `migrate` no longer pretends to execute unimplemented paths; it validates
  compatibility, shows the plan, and points to native tooling.
- Decorative flags and claims that nothing backed: `snapshot --compress/--format`,
  a nonexistent restore suggestion, the global `--config` option, and `init`
  client-SDK / dashboard / `.env` promises.
- `studio` only advertises dashboards that actually exist.

[Unreleased]: https://github.com/hitoshyamamoto/hayai/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/hitoshyamamoto/hayai/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/hitoshyamamoto/hayai/releases/tag/v0.7.1
