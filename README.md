# AgentScope

**See inside your AI agents.**

AgentScope is an open-source observability platform for LLM-powered AI agents. Your agents send runs, spans, artifacts and errors to it, and it lets you:

- browse every run as a trace of spans: LLM calls, tool calls and steps
- search and compare runs, and replay a run step by step
- track token usage and cost per run and per project
- get automatic root-cause analysis and insights for failed runs
- detect recurring issues and regressions, and set up alerts on them
- version prompts and compare prompt versions

## Who it's for

- **Developers building AI agents** who need to debug why an agent failed, looped or produced a bad answer.
- **Teams running agents in production** who want cost tracking, alerts and regression detection across many runs.
- **Self-hosters** who want their agent telemetry in their own Postgres instead of a hosted SaaS.

## Built with

| Part | Stack |
| --- | --- |
| API and ingestion (`apps/backend/api`) | Rust, [Axum](https://github.com/tokio-rs/axum), Tokio |
| Storage (`apps/backend/core/storage`) | PostgreSQL 16, [SQLx](https://github.com/launchbadge/sqlx) (migrations run on startup) |
| Background workers (`apps/backend/core/workers`) | Rust: cost calculation, root-cause analysis, issue and regression detection, alerts, usage aggregation |
| LLM proxy (`apps/llm-proxy`) | Rust: OpenAI-compatible proxy that records telemetry for every call |
| Web UI (`apps/web`) | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Integrations (`examples/n8n-nodes-agentscope`) | n8n community node (TypeScript) |
| Deployment | Docker, Docker Compose |

SDKs (`pip install agentscope-sdk`, `npm install @agentscope/sdk`) are maintained in a separate repository.

## Architecture

```text
Your agent ──SDK / LLM proxy / n8n──▶  Ingestion API (/v1/ingest)
                                              │
                                              ▼
                                         PostgreSQL ◀── Workers (cost, RCA, issues, alerts)
                                              │
                                              ▼
                       Web UI  ◀──────  Query API (/v1/runs, /v1/search, ...)
```

See [`docs/architecture.md`](docs/architecture.md), [`docs/telemetry-spec.md`](docs/telemetry-spec.md) and [`docs/engine-spec.md`](docs/engine-spec.md).

## Repository layout

```text
agentscope/
├─ apps/
│  ├─ backend/
│  │  ├─ api/            # HTTP API (agentscope-api)
│  │  ├─ core/
│  │  │  ├─ common/      # shared config, logging
│  │  │  ├─ storage/     # Postgres access + migrations/
│  │  │  ├─ trace/       # trace model
│  │  │  └─ workers/     # background jobs (agentscope-workers)
│  │  └─ Dockerfile
│  ├─ llm-proxy/         # OpenAI-compatible telemetry proxy
│  └─ web/               # Next.js UI
├─ docs/                 # architecture and specs
├─ examples/
│  └─ n8n-nodes-agentscope/
├─ scripts/              # admin SQL helpers
├─ docker-compose.yml
└─ .env.example
```

## Getting started

### Prerequisites

- Rust (stable) and Cargo
- Node.js 20+ and npm
- Docker (or a local PostgreSQL 16)

### 1. Configure

```bash
cp .env.example .env
# edit .env: at minimum set JWT_SECRET to a long random value
```

### 2. Run Postgres and the API with Docker

```bash
docker compose up --build
```

The API is available at `http://localhost:8080` (OpenAPI docs at `/swagger`), and Postgres at `localhost:5432`.

### Or run the API directly

```bash
docker compose up -d postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agentscope \
JWT_SECRET=dev-only-change-me \
cargo run -p agentscope-api
```

All configuration options, with defaults, are listed in [`.env.example`](.env.example). `DATABASE_URL` values that include `channel_binding=...` are supported (the parameter is stripped before connecting). The API retries the database connection with exponential backoff (`DB_CONNECT_*`, `DB_RUNTIME_*`).

### 3. Run the web UI

```bash
cd apps/web
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080 npm run dev
```

Open `http://localhost:3000`. A fresh local database has a demo login, `owner@demo.agentscope.local` / `demo-password`. Only use it for local development.

### 4. (Optional) Run the background workers

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agentscope \
OPENAI_API_KEY=... \
cargo run -p agentscope-workers
```

The workers compute costs, aggregate usage, evaluate alerts, and (with an LLM key) produce root-cause analyses.

### 5. (Optional) Run the LLM proxy

```bash
OPENAI_API_KEY=... \
AGENTSCOPE_API=http://localhost:8080 \
AGENTSCOPE_API_KEY=... \
cargo run -p agentscope-llm-proxy
```

Point your OpenAI client at `http://127.0.0.1:4318/v1`. Every `chat/completions` call is forwarded to OpenAI and recorded in AgentScope. Create the `AGENTSCOPE_API_KEY` for your project in the web UI.

## Main API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/ingest` | Ingest a run with its spans, artifacts and errors (`x-agentscope-api-key`) |
| `GET` | `/v1/runs` | List runs |
| `GET` | `/v1/runs/{id}` | Run detail |
| `GET` | `/v1/runs/{id}/spans` | Spans for a run |
| `GET` | `/v1/runs/{id}/metrics` | Tokens, cost and latency |
| `GET` | `/v1/runs/{id}/root-cause` | Root-cause analysis |
| `GET` | `/v1/runs/{id}/compare/{other_id}` | Compare two runs |
| `GET` | `/v1/search` | Search runs |

The full spec is served at `/openapi.json` and `/swagger`.

## Tests

```bash
docker compose up -d postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agentscope \
cargo test -p agentscope-api
```

Integration tests use `sqlx::test`, so they need a reachable Postgres.

## Roadmap

Planned work is tracked in [GitHub Issues](https://github.com/dinesh-88/agentscope/issues). Highlights:

- [ ] CI: build, lint and test on every pull request
- [ ] Run API, workers and web UI together with a single `docker compose up`
- [ ] Support more LLM providers in the proxy (Anthropic, Gemini)
- [ ] OpenTelemetry (OTLP) ingestion
- [ ] Tests for the workers and the web UI
- [ ] Publish the n8n node to npm

## License

MIT, see [`LICENSE`](LICENSE).
