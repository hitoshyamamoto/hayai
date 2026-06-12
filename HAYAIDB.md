# 📄 .hayaidb Configuration File

## 🎯 Overview

The `.hayaidb` file is a **declarative configuration file** that defines your
project's databases in one place. It works with two commands:

- `hayai export` — writes a `.hayaidb` file describing your current instances
- `hayai sync` — creates any databases declared in the file that don't exist yet

This makes environments reproducible: commit the file, and a teammate runs
`hayai sync` to get the same databases.

## 🚀 Why Use .hayaidb?

- **🔧 Centralized Configuration**: Define all your databases in one place
- **🔄 Reproducible Environments**: Share configurations across team members
- **📝 Version Control**: Track configuration changes in your repository
- **⚡ Batch Creation**: `hayai sync` creates everything that's missing in one run

## 📁 File Structure

The `.hayaidb` file uses **YAML format**:

```yaml
version: "1.0"            # Required
project: my-app           # Optional project identifier

databases:
  <database-name>:        # Unique instance name
    engine: <engine>      # Required — see supported engines below
    port: <port>          # Optional — auto-allocated (5000-6000) if omitted
    environment:          # Optional — passed to the container
      KEY: value
```

### Honored fields

| Field | Required | Effect |
|-------|----------|--------|
| `version` | ✅ | Must be present; format version |
| `project` | ❌ | Informational |
| `databases.<name>.engine` | ✅ | Must be a supported engine |
| `databases.<name>.port` | ❌ | Preferred host port (1–65535); auto-allocated if omitted or taken |
| `databases.<name>.environment` | ❌ | Environment variables for the container (credentials, db name, ...) |

### Fields that are parsed but **not applied yet**

These may appear in the file (and in exported files from other tools) without
causing errors, but hayai currently ignores them when creating databases:

- `volumes`, `healthcheck` overrides per database
- `memory`, `networks`, `restart` per database
- `profiles` (parsed and displayed by `hayai sync --dry-run`, but not yet
  usable to select subsets)

Only set `engine`, `port`, and `environment` and you'll get exactly what's
written.

## 🗄️ Supported Database Engines

The authoritative list lives in `src/core/templates.ts` and in
`hayai init` (interactive mode shows every engine). Currently 22 engines:

- **SQL:** `postgresql`, `mariadb`
- **Analytics:** `duckdb`
- **Embedded:** `sqlite`, `lmdb`
- **Key-Value:** `redis`, `leveldb`, `tikv`
- **Wide Column:** `cassandra`
- **Vector:** `qdrant`, `weaviate`, `milvus`
- **Graph:** `arangodb`, `nebula`
- **Search:** `meilisearch`, `typesense`
- **Time Series:** `influxdb2`, `influxdb3`, `timescaledb`, `questdb`, `victoriametrics`, `horaedb`

Embedded engines (`sqlite`, `duckdb`, `leveldb`, `lmdb`) are created as plain
host files under `./data/<name>/` — they need no `port` or `environment`.

## 🔧 Commands

```bash
# Export current databases to .hayaidb
hayai export
hayai export -o my-config.yaml

# Preview what sync would create
hayai sync --dry-run

# Create everything declared in .hayaidb (existing instances are skipped)
hayai sync
hayai sync -c my-config.yaml

# Then manage as usual
hayai start
hayai list
```

`hayai sync` is **additive and idempotent**: it never modifies or removes
existing instances; it only creates missing ones and reports
created/skipped/errored names.

## 📚 Examples

### Typical web app stack

```yaml
version: "1.0"
project: my-app

databases:
  main-postgres:
    engine: postgresql
    port: 5432
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: change_me_dev_only

  cache-redis:
    engine: redis
    port: 6379

  search:
    engine: meilisearch
    environment:
      MEILI_MASTER_KEY: dev_master_key
      MEILI_ENV: development
```

### AI/analytics stack

```yaml
version: "1.0"
project: ml-experiments

databases:
  vectors:
    engine: qdrant

  metrics:
    engine: influxdb2
    environment:
      DOCKER_INFLUXDB_INIT_MODE: setup
      DOCKER_INFLUXDB_INIT_USERNAME: admin
      DOCKER_INFLUXDB_INIT_PASSWORD: dev_password_123
      DOCKER_INFLUXDB_INIT_ORG: my-org
      DOCKER_INFLUXDB_INIT_BUCKET: metrics

  scratchpad:
    engine: duckdb     # embedded — just a file, no port needed
```

### Notes on environment variables

Use the variables the official Docker image of each engine actually reads,
e.g.:

- `postgresql` / `timescaledb`: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- `mariadb`: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- `influxdb2`: the `DOCKER_INFLUXDB_INIT_*` family
- `meilisearch`: `MEILI_MASTER_KEY`, `MEILI_ENV`

Variables an image doesn't recognize are passed through but have no effect.

## ⚠️ Security Reminder

`.hayaidb` files contain development credentials in plain text by design.
Keep production secrets out of them, and see [SECURITY.md](SECURITY.md) for
hayai's threat model.
