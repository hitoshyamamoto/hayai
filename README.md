<div align="center">
  <img src="assets/logo_hayai.png" alt="Hayai Logo" width="200"/>
  <h1>Hayai ⚡</h1>
  <p><em>Instantly create and manage local databases with one command</em></p>
  
  ![GitHub Actions](https://github.com/hitoshyamamoto/hayai/workflows/CI/badge.svg)
  ![npm version](https://img.shields.io/npm/v/hayai-db.svg)
  ![License](https://img.shields.io/badge/license-MIT-blue.svg)
  ![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
  
  ![npm downloads](https://img.shields.io/npm/dw/hayai-db.svg)
  ![GitHub stars](https://img.shields.io/github/stars/hitoshyamamoto/hayai.svg?style=social)
  ![GitHub forks](https://img.shields.io/github/forks/hitoshyamamoto/hayai.svg?style=social)
  
  ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
  ![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
  ![Databases](https://img.shields.io/badge/Databases-22-success)
  ![CLI](https://img.shields.io/badge/CLI-Tool-blue)
  
  ![Security](https://img.shields.io/badge/Security-0%20vulnerabilities-brightgreen)
  ![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)
  ![Maintenance](https://img.shields.io/badge/Maintained-Yes-brightgreen)
</div>

<br>

## 🇯🇵 About the Name

**Hayai** (速い) means "fast" or "quick" in Japanese. This CLI tool lives up to its name by instantly creating and managing local databases with a single command.

## 🚀 What is Hayai?

Fast, modern CLI tool for managing local SQL and NoSQL databases with Docker. Built for backend developers who need quick database instances for development and testing.

**Perfect for:**
- 🏗️ **Local Development** - Spin up databases instantly
- 🧪 **Testing Environments** - Isolated database instances
- 🔬 **Experimentation** - Try different databases quickly
- 📚 **Learning** - Explore various database technologies

## 🌟 Support & Community

If you find Hayai useful, please consider giving us a ⭐ **Star** on GitHub! It helps us understand that people are using and appreciating the project, and motivates us to keep improving it.

<div align="center">
  <a href="https://github.com/hitoshyamamoto/hayai">
    <img src="https://img.shields.io/github/stars/hitoshyamamoto/hayai?style=social" alt="GitHub stars">
  </a>
  <a href="https://github.com/hitoshyamamoto/hayai/fork">
    <img src="https://img.shields.io/github/forks/hitoshyamamoto/hayai?style=social" alt="GitHub forks">
  </a>
</div>

### 💬 Get Involved

We're building Hayai to be the best database management tool for developers, and your input matters:

- **🐛 Found a bug?** Report it in our [Issues](https://github.com/hitoshyamamoto/hayai/issues) section
- **💡 Have an idea?** Share it in [Discussions](https://github.com/hitoshyamamoto/hayai/discussions)
- **🚀 Want a new database?** Request it through [Feature Requests](https://github.com/hitoshyamamoto/hayai/issues/new?template=feature_request.md)
- **📖 Need help?** Ask questions in [Discussions](https://github.com/hitoshyamamoto/hayai/discussions/categories/q-a)

### 🤝 Contributing

Hayai is open-source and welcomes contributions! Whether it's:
- 🔧 Code improvements
- 📝 Documentation updates  
- 🐛 Bug reports
- 💡 Feature suggestions
- 🌐 Translations

Check out our [Contributing Guide](CONTRIBUTING.md) to get started!

## ⚡ Quick Start

```bash
# Install globally
npm install -g hayai-db

# Initialize a PostgreSQL database
hayai init

# Start all databases
hayai start

# Open admin dashboards
hayai studio
```

## 🎯 Key Features

- **🔓 Open-Source Focused**: Open-source engines (one source-available: TimescaleDB)
- **⚡ One Command Setup**: Initialize any database with a single command
- **🐳 Docker-Powered**: Automated container management with health checks
- **📁 Embedded Engines as Files**: SQLite, DuckDB, LevelDB, and LMDB are managed as plain host files — no container overhead
- **🔧 Smart Port Management**: Intelligent port allocation (5000-6000 range)
- **🌐 Admin Dashboards**: One-command access to the web UIs that engines ship built-in (Qdrant, ArangoDB, InfluxDB, QuestDB, Meilisearch, VictoriaMetrics)
- **✨ Modern CLI**: Interactive prompts with beautiful output

## 📦 Supported Databases

All databases are **100% open-source** with permissive licenses:

<details>
<summary><strong>SQL Databases (2)</strong></summary>

- **PostgreSQL** (PostgreSQL License) - Most popular open-source relational database
- **MariaDB** (GPL v2) - MySQL community fork with enhanced features
</details>

<details>
<summary><strong>Analytics Databases (1)</strong></summary>

- **DuckDB** (MIT) - Analytics-focused columnar SQL database for OLAP workloads
</details>

<details>
<summary><strong>Embedded Databases (2)</strong></summary>

- **SQLite** (Public Domain) - Lightweight embedded SQL database
- **LMDB** (OpenLDAP Public License) - Ultra-fast memory-mapped embedded key-value store
</details>

<details>
<summary><strong>Key-Value Databases (3)</strong></summary>

- **Redis** (BSD 3-Clause) - High-performance in-memory key-value store
- **LevelDB** (BSD) - High-performance embedded key-value storage library
- **TiKV** (Apache 2.0) - CNCF graduated distributed transactional key-value store
</details>

<details>
<summary><strong>Wide Column Databases (1)</strong></summary>

- **Apache Cassandra** (Apache 2.0) - Distributed wide column store
</details>

<details>
<summary><strong>Vector Databases (3)</strong></summary>

- **Qdrant** (Apache 2.0) - Vector database with REST API
- **Weaviate** (BSD 3-Clause) - Vector search engine with ML models
- **Milvus** (Apache 2.0) - Vector database for AI applications
</details>

<details>
<summary><strong>Graph Databases (2)</strong></summary>

- **ArangoDB** (Apache 2.0) - Multi-model database (graph, document, key-value)
- **NebulaGraph** (Apache 2.0) - Distributed graph database with millisecond latency
</details>

<details>
<summary><strong>Search Databases (2)</strong></summary>

- **Meilisearch** (MIT) - Modern full-text search engine
- **Typesense** (GPL v3) - Fast, typo-tolerant search engine
</details>

<details>
<summary><strong>Time Series Databases (6)</strong></summary>

- **InfluxDB 2.x** (MIT) - Modern time series platform with full features
- **InfluxDB 3 Core** (MIT/Apache 2.0) - Latest generation time series database
- **TimescaleDB** (Timescale License) - PostgreSQL-based time series database
- **QuestDB** (Apache 2.0) - High-performance time series with SQL support
- **VictoriaMetrics** (Apache 2.0) - Prometheus-compatible metrics database
- **Apache HoraeDB** (Apache 2.0) - Cloud-native distributed time series database
</details>

**Total: 22 databases across 9 categories**

## 🛠️ Installation

### Prerequisites
- **Node.js** 18.0.0 or higher
- **Docker** and **Docker Compose**

### Install Hayai
```bash
npm install -g hayai-db
```

### Verify Installation
```bash
hayai --version
```

## 📋 Commands Reference

### Core Commands

| Command | Description | Example |
|---------|-------------|---------|
| `hayai init` | Initialize a new database instance | `hayai init -n mydb -e postgresql` |
| `hayai start [name]` | Start database instances | `hayai start` or `hayai start mydb` |
| `hayai stop [name]` | Stop database instances | `hayai stop` or `hayai stop mydb` |
| `hayai list` | List all database instances | `hayai list --running` |
| `hayai studio [name]` | Open admin dashboards | `hayai studio mydb` |

### Configuration Commands

| Command | Description | Example |
|---------|-------------|---------|
| `hayai export` | Export current databases to a `.hayaidb` file | `hayai export -o .hayaidb` |
| `hayai sync` | Create databases from a `.hayaidb` file | `hayai sync --dry-run` |

📚 **See [HAYAIDB.md](HAYAIDB.md) for complete configuration file documentation**

### Management Commands

| Command | Description | Example |
|---------|-------------|---------|
| `hayai remove <name>` | Remove database instance | `hayai remove mydb --keep-data` |
| `hayai logs <name>` | Stream database container logs | `hayai logs mydb --follow` |
| `hayai snapshot <name>` | Create database snapshot | `hayai snapshot mydb` |
| `hayai clone <options>` | Clone database instances | `hayai clone --from prod --to staging` |
| `hayai merge <options>` | Merge a source database into a target | `hayai merge --source dbA --target dbB --preview` |
| `hayai migrate <options>` | Plan a cross-engine migration (validation + guidance; execution not yet implemented) | `hayai migrate -f db1 -t db2 -e influxdb3 --dry-run` |

📸 **For complete backup and snapshot documentation, see: [ABOUT_BACKUP.md](ABOUT_BACKUP.md)**

### Detailed Usage

<details>
<summary><strong>hayai init</strong> - Initialize Database</summary>

```bash
# Interactive mode
hayai init

# Quick setup
hayai init -n mydb -e postgresql -p 5432 -y

# Redis cache
hayai init -n cache -e redis -y
```

**Options:**
- `-n, --name <name>` - Database name
- `-e, --engine <engine>` - Database engine
- `-p, --port <port>` - Port number
- `-y, --yes` - Skip confirmations
</details>

<details>
<summary><strong>hayai start</strong> - Start Databases</summary>

```bash
# Start all databases
hayai start

# Start specific database
hayai start mydb
```
</details>

<details>
<summary><strong>hayai clone</strong> - Clone Database Instances</summary>

```bash
# Simple 1:1 clone
hayai clone --from prod --to staging
hayai clone -f prod -t staging -y

# Clone to multiple databases (1:N)
hayai clone --from prod --to-multiple "test1,test2,test3"
hayai clone -f prod -tm "dev,staging,qa" -y

# Preview clone without executing
hayai clone -f prod -t staging --dry-run

# Force overwrite existing databases
hayai clone -f prod -t staging --force -y
```

**Options:**
- `-f, --from <name>` - Source database name
- `-t, --to <name>` - Target database name (1:1 clone)
- `-tm, --to-multiple <names>` - Target database names (comma-separated, 1:N clone)
- `-y, --confirm` - Skip confirmation prompt
- `--force` - Overwrite existing target databases
- `--dry-run` - Show what would be cloned without executing

**Supported Engines:** PostgreSQL, MariaDB, Redis (native tooling); SQLite, DuckDB, LevelDB, LMDB (host file copy). Other engines require manual cloning with their native tools — the command prints guidance.
</details>

<details>
<summary><strong>hayai merge</strong> - Merge Database Instances</summary>

```bash
# Preview merge operation
hayai merge --source dbA --target dbB --preview
hayai merge -s dbA -t dbB --preview

# Execute merge operation
hayai merge --source dbA --target dbB --execute
hayai merge -s dbA -t dbB --execute

# Force merge without confirmation
hayai merge -s dbA -t dbB --execute --force
```

**Options:**
- `-s, --source <name>` - Source database name
- `-t, --target <name>` - Target database name
- `--preview` - Preview the merge operation without executing
- `--execute` - Execute the merge operation
- `--backup-both` - Create backups of both databases before merging
- `--force` - Skip confirmation prompts

**How Merge Works:**
- Data from the source is copied into the target
- The source database is left unchanged
- Conflicts are resolved in favor of the source when possible

**Supported Engines:** PostgreSQL (SQL-level), MariaDB (SQL-level), Redis (key-level via native MIGRATE), others (generic file-based, best-effort).
</details>

<details>
<summary><strong>hayai list</strong> - List Databases</summary>

```bash
# List all databases
hayai list

# Show only running databases
hayai list --running

# JSON output
hayai list --format json
```
</details>

## 🔧 Configuration

Hayai uses a `hayai.config.yaml` file for global configuration:

```yaml
version: '1.0.0'
docker:
  network_name: hayai-network
  compose_file: docker-compose.yml
  data_directory: ./data
logging:
  level: info
  file: hayai.log
defaults:
  port_range:
    start: 5000
    end: 6000
  volume_driver: local
  restart_policy: unless-stopped
```

## 📄 .hayaidb - Declarative Database Configuration

The `.hayaidb` file provides a **declarative approach** to database management, allowing you to define multiple databases with their configurations in a single file.

### ✅ **Key Benefits**
- **🔧 Centralized Configuration**: Define all databases in one place
- **📋 Declarative Setup**: Specify what you want, not how to achieve it
- **🔄 Reproducible Environments**: Share configurations across team members
- **⚡ Batch Operations**: Initialize, start, or stop multiple databases at once

### 🚀 **Quick Example**
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
      POSTGRES_PASSWORD: password
  
  cache-redis:
    engine: redis
    port: 6379
    environment:
      REDIS_PASSWORD: password
  
  metrics-influxdb2:
    engine: influxdb2
    port: 8086
    environment:
      DOCKER_INFLUXDB_INIT_USERNAME: admin
      DOCKER_INFLUXDB_INIT_PASSWORD: password
      DOCKER_INFLUXDB_INIT_ORG: myapp-org
      DOCKER_INFLUXDB_INIT_BUCKET: metrics
```

### 🔧 **Usage**
```bash
# Create all databases declared in .hayaidb (skips ones that exist)
hayai sync

# Preview what sync would create
hayai sync --dry-run

# Export your current databases to a .hayaidb file
hayai export
```

📚 **For complete documentation and examples, see: [HAYAIDB.md](HAYAIDB.md)**

## 📚 Usage Examples

### Development Environment Setup

```bash
# Main database
hayai init -n maindb -e postgresql -y

# Caching layer
hayai init -n cache -e redis -y

# Search functionality
hayai init -n search -e meilisearch -y

# Start all services
hayai start

# Check status
hayai list
```

### AI/ML Development Stack

```bash
# Vector database for embeddings
hayai init -n vectors -e qdrant -y

# Time series for metrics
hayai init -n metrics -e influxdb3 -y

# Traditional data storage
hayai init -n data -e postgresql -y

# Launch everything
hayai start
hayai studio  # Open all dashboards
```

### Microservices Testing

```bash
# User service database
hayai init -n users -e postgresql -p 5432 -y

# Session store
hayai init -n sessions -e redis -p 6379 -y

# Analytics database
hayai init -n analytics -e questdb -p 9000 -y

# Graph relationships
hayai init -n graph -e arangodb -p 8529 -y
```

## 🌟 Why Choose Hayai?

### 🎯 Developer Experience
- **Interactive CLI** - Beautiful prompts with validation
- **Smart Defaults** - Sensible configuration out of the box
- **Error Handling** - Clear error messages and recovery suggestions
- **Honest Output** - Commands report what actually happened, and unimplemented paths say so

### 🚀 Performance & Flexibility
- **Fast Setup** - Databases ready in seconds
- **Resource Efficient** - Optimized Docker configurations
- **Multi-Database** - Run multiple instances simultaneously
- **Environment Isolation** - Clean separation between projects

### 📊 Comprehensive Database Support
- **SQL Databases** - PostgreSQL, MariaDB, SQLite, DuckDB
- **Time Series** - InfluxDB 2.x, InfluxDB 3 Core, TimescaleDB, QuestDB, VictoriaMetrics, HoraeDB
- **Vector Search** - Qdrant, Weaviate, Milvus
- **Search Engines** - Meilisearch, Typesense
- **Specialized** - Redis, Cassandra, ArangoDB, LevelDB

## 🔄 Dependency Management

### Core Dependencies
- **chalk** - Terminal colors and styling
- **commander** - Command-line interface framework
- **inquirer** - Interactive command-line prompts
- **ora** - Loading spinners and progress indicators
- **yaml** - YAML parser and stringifier

Docker is driven through the `docker` CLI (Compose V2), so there is no
Docker SDK dependency. `npm audit` currently reports 0 vulnerabilities.

## 🎨 Project Branding

### Logo Usage
The Hayai logo is located in the `assets/` directory:

- **Main Logo**: `assets/logo_hayai.png` - Primary logo for README and documentation
- **Complete Logo**: `assets/complete_logo_hayai.png` - Full logo with text
- **Format**: PNG with transparent background
- **Usage**: Free for open-source projects, attribution appreciated

### GitHub Repository Settings
To use the logo in different GitHub contexts:

1. **Social Preview**: Repository Settings → General → Social Preview (1280x640px)
2. **README Header**: Already configured using `logo_hayai.png`
3. **Issues/PRs**: Reference using `![Hayai Logo](assets/logo_hayai.png)`

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup
```bash
# Clone the repository
git clone https://github.com/hitoshyamamoto/hayai.git

# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run linting
npm run lint
```

### 📖 Documentation
- [Contributing Guide](CONTRIBUTING.md) - How to contribute to the project
- [Development Guide](DEVELOPMENT.md) - Development setup and workflow
- [.hayaidb Configuration](HAYAIDB.md) - Declarative database configuration guide
- [Backup & Snapshots](ABOUT_BACKUP.md) - Complete backup and restoration guide

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- **Docker** - Container platform that makes everything possible
- **Open-source database communities** - For creating amazing databases
- **Node.js ecosystem** - For excellent tooling and libraries
- **Professional experience** - Real-world development needs and pain points that inspired this solution
- **Personal curiosity** - The desire to create my first own project and learn through building

---

<div align="center">
  <p>Built to simplify and accelerate your development by <a href="https://github.com/hitoshyamamoto">hitoshyamamoto</a></p>
  <p><em>Making database management 速い (hayai) since 2025</em></p>
</div>
