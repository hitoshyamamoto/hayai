# Security Policy

Hayai is a **local development tool**. It creates databases with known default
credentials and exposes them on host ports for convenience. Do not use it to
host production data, and do not run it on machines where untrusted users or
networks can reach the published ports.

This document describes the security properties hayai actually has today,
its known limitations, and how to report vulnerabilities.

## Threat model

Hayai assumes:

- A single developer machine (or trusted CI runner).
- Docker is trusted: anyone who can talk to the Docker daemon already
  controls the host.
- The data inside hayai-managed databases is development data.

If any of these assumptions don't hold for you, hayai is the wrong tool.

## Current security properties

### Default credentials

Database templates ship with **fixed, documented default credentials**
(for example `admin` / `password` for PostgreSQL). This is a deliberate
convenience trade-off for local development, the same one made by most
docker-compose dev setups. Treat every hayai-managed database as if its
password were public — because it is.

You can change credentials per instance via the `environment` section of a
`.hayaidb` file or by passing custom environment values at creation time.

### Network exposure

Published ports bind to all interfaces (`0.0.0.0`), so hayai databases are
reachable from your local network, not just localhost. On a laptop on
untrusted Wi-Fi, combined with default credentials, this means anyone on the
network segment can connect. Use a host firewall, or restrict bindings, if
this matters in your environment. Binding to `127.0.0.1` by default is
planned.

### Command execution

- Database tooling (`pg_dump`, `mysqldump`, `redis-cli`, ...) runs via
  `docker exec` using each instance's own credentials, taken from its
  environment.
- MariaDB passwords are passed via the `MYSQL_PWD` environment variable so
  they don't appear in the in-container command line. They are briefly
  visible in the host process list as part of the `docker exec -e` arguments.
- PostgreSQL access inside the container uses the local socket, which the
  official image trusts — no password crosses a network.

### The `hayai security` command

The `security` command provides **standalone utilities**:

- `--generate` — generates random passwords using `crypto.randomInt`.
- `--credentials` — stores per-instance credentials in
  `.hayai/credentials.enc`, encrypted with AES-256-CBC. The encryption key
  is stored beside the ciphertext in `.hayai/.key` (file mode `0600`).
  **This protects against casual file reading only** — anyone with access to
  the directory has the key too. It is obfuscation-at-rest, not a vault.
- `--init` / `--policy` — writes and shows a security policy file
  (`.hayai/security.json`).
- `--audit` — shows the audit log at `.hayai/audit.log`.

### Honest limitations (important)

The following are **not yet enforced**, even though the configuration for
them exists:

- **The security policy is not consulted by `clone`, `merge`, or any other
  data operation.** Setting `allowedOperations` or rate limits in the policy
  file currently has no effect on those commands.
- **Operations do not write to the audit log.** `hayai security --audit`
  will show entries only if future versions wire operations into it.
- **Rate limiting is per-process.** A CLI invocation lives for seconds, so
  the configured operations-per-hour limit cannot constrain anything across
  invocations.
- **Network isolation helpers exist in the codebase but are unused** by the
  commands.
- The stored credentials in `.hayai/credentials.enc` are **not used by the
  data commands**, which read credentials from each instance's environment.

Wiring the policy, audit log, and credential store into the actual
operations is tracked as roadmap work. Until then, configure them only if
you want the files in place for the future — they do not protect anything
today.

## Hardening recommendations

- Keep hayai-managed databases off machines exposed to untrusted networks,
  or firewall the published port range (default 5000–6000).
- Override default credentials via instance environment when anything
  semi-sensitive is loaded into a dev database.
- Add `.hayai/` to your `.gitignore` (key material and credential store).
- Snapshot before destructive operations: `hayai snapshot <name>`.

## Reporting a vulnerability

If you find a security issue in hayai itself (command injection, path
traversal, credentials leaking into logs, etc.):

- Open an issue at <https://github.com/hitoshyamamoto/hayai/issues>, or
- Email the maintainer at <andrehitoshi.01@gmail.com> for anything you'd
  rather not disclose publicly.

Please include reproduction steps and the hayai/Docker versions involved.
You should receive a response within a week.
