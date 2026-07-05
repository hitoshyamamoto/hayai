"""Ephemeral staging database per DAG run, managed by hayai.

The canonical hayai + Airflow pattern: provision a disposable PostgreSQL
instance at the start of the run, execute the pipeline against it, and tear it
down unconditionally at the end — even when upstream tasks fail.

Every hayai call below leans on the automation contract (AUTOMATION.md):

- ``--exists-ok`` / ``--missing-ok`` make provision and teardown idempotent,
  so Airflow retries never fail on their own previous success.
- ``--json`` keeps stdout parseable; semantic exit codes (3 not-found,
  5 precondition, 6 docker-down) become task failures with a diagnosable
  cause instead of a generic exit 1.
- ``hayai connect --uri`` emits only the URI, so it drops straight into an
  environment variable.

Requirements on the worker: hayai-db installed globally (npm install -g
hayai-db), Docker daemon available, and a working directory the DAG owns
(HAYAI_PROJECT_DIR) — hayai state is per-directory.
"""

from __future__ import annotations

import os

import pendulum
from airflow.models.dag import DAG
from airflow.operators.bash import BashOperator

HAYAI_PROJECT_DIR = os.environ.get("HAYAI_PROJECT_DIR", "/opt/airflow/hayai-staging")

# One instance per logical date keeps concurrent runs isolated; ds_nodash is
# already filesystem- and DNS-safe.
INSTANCE = "staging-{{ ds_nodash }}"

with DAG(
    dag_id="hayai_ephemeral_staging",
    description="Provision → load → verify → teardown a disposable PostgreSQL via hayai",
    start_date=pendulum.datetime(2026, 1, 1, tz="UTC"),
    schedule="@daily",
    catchup=False,
    tags=["hayai", "example"],
) as dag:
    provision = BashOperator(
        task_id="provision_staging_db",
        cwd=HAYAI_PROJECT_DIR,
        bash_command=(
            f"hayai init -n {INSTANCE} -e postgresql --exists-ok --json"
            f" && hayai start {INSTANCE} --json"
        ),
    )

    # The URI goes to XCom via stdout (do_xcom_push). The stderr banner does
    # not pollute it — hayai keeps stdout machine-readable by contract.
    export_uri = BashOperator(
        task_id="export_connection_uri",
        cwd=HAYAI_PROJECT_DIR,
        bash_command=f"hayai connect {INSTANCE} --uri",
        do_xcom_push=True,
    )

    # Stand-in for the real pipeline: any task that consumes DATABASE_URL.
    run_etl = BashOperator(
        task_id="run_etl",
        cwd=HAYAI_PROJECT_DIR,
        bash_command=(
            'echo "loading into $DATABASE_URL" '
            "&& psql \"$DATABASE_URL\" -c 'CREATE TABLE IF NOT EXISTS etl_check (id int)'"
            " && psql \"$DATABASE_URL\" -c 'INSERT INTO etl_check VALUES (1)'"
        ),
        env={
            "DATABASE_URL": "{{ ti.xcom_pull(task_ids='export_connection_uri') }}",
        },
    )

    # Optional: keep an artifact of the staging state before it disappears.
    snapshot = BashOperator(
        task_id="snapshot_before_teardown",
        cwd=HAYAI_PROJECT_DIR,
        bash_command=f"hayai snapshot {INSTANCE} --json",
    )

    # trigger_rule=all_done: the teardown runs whether the pipeline succeeded
    # or not — disposable means disposable. --missing-ok keeps retries green.
    teardown = BashOperator(
        task_id="teardown_staging_db",
        cwd=HAYAI_PROJECT_DIR,
        bash_command=f"hayai remove {INSTANCE} --force --missing-ok --json",
        trigger_rule="all_done",
    )

    provision >> export_uri >> run_etl >> snapshot >> teardown
