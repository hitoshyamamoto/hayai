# 📸 Backup & Snapshot System

## 🎯 Overview

`hayai snapshot` creates per-database backups using each engine's **native
backup tool**, written to a local directory. Restoring is currently a
**manual step** (documented below) — a `restore` command is on the roadmap.

## 📸 Creating Snapshots

```bash
# Snapshot a database (default output: ./snapshots)
hayai snapshot <database-name>

# Custom output directory
hayai snapshot mydb --output ./my-backups

# List existing snapshots
hayai snapshot list

# Remove old snapshots, keeping the most recent 5 per database
hayai snapshot clean
hayai snapshot clean --keep 10
```

Snapshots are named `<name>-snapshot-<timestamp>.<ext>`.

### Engines & formats

| Engine | Backup method | Output |
|--------|---------------|--------|
| PostgreSQL, TimescaleDB | `pg_dump --clean --create` (instance credentials) | `.sql` |
| MariaDB | `mysqldump --all-databases` (instance credentials) | `.sql` |
| Redis | `BGSAVE` + RDB copy | `.rdb` |
| InfluxDB 2.x | `influx backup` + tar | `.tar.gz` |
| Cassandra | `nodetool snapshot` + tar | `.tar.gz` |
| SQLite, DuckDB, LevelDB, LMDB | host-side archive of the data directory | `.tar.gz` |
| All others | tar of the container's data directory | `.tar.gz` |

Requirements: the database must be **running** (embedded engines are always
snapshottable since they're plain files).

## ♻️ Restoring (manual for now)

### PostgreSQL / TimescaleDB

```bash
# Restore into a running hayai instance (use the instance's credentials)
docker exec -i <name>-db psql -U admin -d postgres < snapshots/<file>.sql
```

The dump was taken with `--clean --create`, so it drops and recreates the
database it contains.

### MariaDB

```bash
docker exec -i -e MYSQL_PWD=<root-password> <name>-db mysql -u root < snapshots/<file>.sql
```

### Redis

```bash
# Stop the instance, replace the RDB file, start again
hayai stop <name>
docker cp snapshots/<file>.rdb <name>-db:/data/dump.rdb
hayai start <name>
```

### Embedded engines (SQLite, DuckDB, LevelDB, LMDB)

```bash
# The snapshot is a tar of the instance's data directory
tar -xzf snapshots/<file>.tar.gz -C ./data/<name>/
```

### InfluxDB 2.x

```bash
docker cp snapshots/<file>.tar.gz <name>-db:/tmp/
docker exec <name>-db sh -c 'cd /tmp && tar -xzf <file>.tar.gz && influx restore /tmp/backup'
```

## 🤖 Automation

Schedule snapshots with cron using the real commands:

```bash
# Nightly snapshot of one database at 02:00
0 2 * * * cd /path/to/project && hayai snapshot mydb

# Snapshot every database (requires jq)
0 2 * * * cd /path/to/project && hayai list --format json | jq -r '.[].name' | xargs -I{} hayai snapshot {}

# Weekly cleanup, keep last 10 per database
0 3 * * 0 cd /path/to/project && hayai snapshot clean --keep 10
```

## 💡 Tips

- Snapshot before destructive operations (`merge --execute`, `remove`,
  experimental schema changes).
- Add `snapshots/` to `.gitignore` (hayai's default `.gitignore` already
  does) — dumps can be large and may contain data you don't want in git.
- For full-environment portability, combine `hayai export` (the `.hayaidb`
  file recreates the *instances*) with snapshots (which carry the *data*).

## 🗺️ Roadmap

- `hayai snapshot restore <file>` — one-command restore per engine
- Optional compression flag once it compresses for real

See [SECURITY.md](SECURITY.md) for how credentials are handled during backups.
