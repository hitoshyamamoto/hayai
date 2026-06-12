# Development Setup Guide

Before you start working on Hayai, make sure you have the following installed:

- **Node.js** (v18 or higher)
- **npm**
- **Docker** with the Compose V2 plugin (for testing database containers)
- **Git**

The supported database list lives in `src/core/templates.ts` — that file is
the source of truth, not this document.

## Installation

```bash
git clone https://github.com/hitoshyamamoto/hayai.git
cd hayai
npm install
```

On Windows, WSL2 is recommended (Docker Desktop integrates with it directly),
but PowerShell with Node.js for Windows works too.

## Development Commands

```bash
# Build and run the CLI once
npm run dev

# Build the project
npm run build

# Run tests
npm test

# Lint code (and auto-fix)
npm run lint
npm run lint:fix
```

## Testing Your CLI

```bash
# Run the CLI in development mode
npm run dev -- --help

# Test the init command
npm run dev -- init

# Test other commands
npm run dev -- list
npm run dev -- start
npm run dev -- stop
```

## Project Structure

```
hayai/
├── src/
│   ├── cli/                  # CLI interface
│   │   ├── index.ts          # Main CLI entry point
│   │   └── commands/         # One file per command:
│   │                         #   init, start, stop, list, remove, logs,
│   │                         #   studio, snapshot, clone, merge, migrate,
│   │                         #   export, sync, security
│   ├── core/                 # Core engine logic
│   │   ├── types.ts          # Type definitions
│   │   ├── config.ts         # hayai.config.yaml management
│   │   ├── docker.ts         # Docker / Compose integration
│   │   ├── credentials.ts    # Credentials for exec'd db tooling
│   │   ├── port-manager.ts   # Port allocation
│   │   ├── templates.ts      # Database engine templates (source of truth)
│   │   ├── hayaidb.ts        # .hayaidb export/sync
│   │   └── security.ts       # Standalone security utilities
│   └── tests/                # Jest tests
├── dist/                     # Compiled output
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
└── hayai.config.yaml         # Global configuration
```

## How Things Work

- Hayai writes a `docker-compose.yml` in the working directory and drives it
  with `docker compose` (V2). Each instance becomes a `<name>-db` service.
- Embedded engines (sqlite, duckdb, leveldb, lmdb) get **no container** —
  they are plain files under `./data/<name>/` with status `embedded`.
- Instance state is persisted in `./data/instances.json`; port allocations in
  `./data/port-allocations.json`.
- Database tooling (pg_dump, mysqldump, redis-cli, ...) runs via `docker exec`
  using each instance's own environment credentials
  (see `src/core/credentials.ts`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch/commit/PR workflow.

## Troubleshooting

### Docker Issues
Make sure Docker and Compose V2 are available:
```bash
docker --version
docker compose version
docker ps
```

### Node.js Not Found
- **WSL/Linux**: `sudo apt update && sudo apt install nodejs npm`
- **Windows**: Download from [nodejs.org](https://nodejs.org/)

Ready to build the future of local database management! 🚀
