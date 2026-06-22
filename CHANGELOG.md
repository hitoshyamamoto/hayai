# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-06-22

### Added
- `hayai restore <snapshot>` closes the snapshot loop: replays SQL dumps
  (PostgreSQL, TimescaleDB, MariaDB), swaps the RDB for Redis, and extracts the
  data directory for embedded engines. Snapshot-only engines are refused with
  pointers to their native restore tooling.
- Audit logging is enforced: `clone`, `merge`, `snapshot`, `restore`, and
  `remove` append to `.hayai/audit.log` when `auditOperations` is enabled
  (default), so `hayai security --audit` reflects real activity.
- CI runs lint, a Node 18/20/22 test matrix, a compiled-CLI smoke test, a
  packaging dry-run, and a dependency audit, with all actions pinned by commit SHA.
- CodeQL static analysis (`security-and-quality`) on push, pull request, and weekly.
- Dependabot for npm and GitHub Actions, grouped to keep update noise down.

### Changed
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
