# hayai + Apache Airflow

Airflow orchestrates *when*; hayai owns *how* database instances are created,
backed up, restored and destroyed. The two meet through the CLI — the same
path dbt took into the Airflow ecosystem before dedicated operators existed.
Everything here works with plain `BashOperator`; no provider package required.

## Prerequisites (on the Airflow worker)

- `npm install -g hayai-db` (Node ≥ 22.13)
- A Docker daemon the worker can reach
- A dedicated working directory for hayai state (its inventory is
  per-directory), e.g. `/opt/airflow/hayai-staging`

## Pattern 1 — ephemeral staging database per DAG run

See [`hayai_ephemeral_staging.py`](hayai_ephemeral_staging.py) for the
complete DAG. The shape:

```
provision (init --exists-ok && start)
  → export_connection_uri (connect --uri → XCom)
  → run_etl ($DATABASE_URL)
  → snapshot (optional artifact)
  → teardown (remove --force --missing-ok, trigger_rule=all_done)
```

Why this is retry-safe and crash-safe, in contract terms
([AUTOMATION.md](../../AUTOMATION.md)):

| Property | Mechanism |
|---|---|
| Retried provision doesn't fail on its own success | `init --exists-ok` exits 0 with `created: false` |
| Retried teardown doesn't fail on missing instance | `remove --missing-ok` exits 0 with `removed: false` |
| Teardown always runs | `trigger_rule="all_done"` + idempotent remove |
| Failures are diagnosable from the exit code | 3 = not found, 5 = wrong state, 6 = Docker down |
| XCom stays clean | stdout carries only data; banner and hints go to stderr |

## Pattern 2 — hayai as the source of Airflow connections

Airflow reads connections from `AIRFLOW_CONN_*` environment variables. hayai
generates them from its inventory:

```bash
# In the environment that launches the scheduler/workers:
set -a; source <(hayai env --format airflow); set +a
```

An instance named `analytics` running PostgreSQL becomes the Airflow
connection id `analytics` (via `AIRFLOW_CONN_ANALYTICS`), usable by any
`PostgresOperator`/hook. Engines without a well-known Airflow connection type
are skipped and listed on stderr — nothing is emitted that Airflow would
reject at task runtime. `hayai env --format airflow --json` gives the same
data structured, including the skipped list.

## Pattern 3 — scheduled maintenance

Any hayai verb is cron-safe under the contract. A weekly snapshot DAG is one
task:

```python
BashOperator(
    task_id="weekly_snapshots",
    cwd=HAYAI_PROJECT_DIR,
    bash_command="hayai snapshot analytics --json && hayai snapshot cache --json",
)
```

## Notes and limits

- hayai state is **per working directory** — always set `cwd` (or `cd`) to
  the same project directory across tasks and DAGs that share instances.
- Concurrent tasks are safe: hayai serializes state mutations through an
  advisory lock and re-reads state inside it.
- Instances bind to the worker's localhost. For remote workers, the database
  and the task that uses it must run on the same host (or the port must be
  reachable) — hayai is a local control plane, not a network service.
