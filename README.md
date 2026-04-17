# AgentScope Engine

Rust implementation of AgentScope telemetry ingestion and query engine.

## License

This repository is proprietary and private. See [`LICENSE`](./LICENSE).

## Repository Layout

```text
agentscope/
├─ Cargo.toml
├─ apps/
│  ├─ api/
│  │  ├─ api/
│  │  ├─ common/
│  │  ├─ storage/
│  │  ├─ trace/
│  │  └─ workers/
│  └─ web/
├─ docker/
├─ docs/
│  ├─ architecture.md
│  ├─ telemetry-spec.md
│  └─ engine-spec.md
├─ scripts/
└─ README.md
```

SDKs are maintained in a separate public repository.

## Run API

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agentscope \
DB_POOL_MAX_CONNECTIONS=10 \
DB_POOL_MIN_CONNECTIONS=0 \
DB_POOL_ACQUIRE_TIMEOUT_SECONDS=10 \
DB_POOL_IDLE_TIMEOUT_SECONDS=300 \
DB_POOL_MAX_LIFETIME_SECONDS=1800 \
DB_CONNECT_RETRIES=5 \
DB_CONNECT_RETRY_BASE_MILLIS=500 \
DB_CONNECT_RETRY_MAX_MILLIS=5000 \
DB_RUNTIME_RETRY_ATTEMPTS=6 \
DB_RUNTIME_RETRY_BASE_MILLIS=200 \
DB_RUNTIME_RETRY_MAX_MILLIS=2000 \
DB_RUNTIME_RETRY_TIMEOUT_SECONDS=20 \
SERVER_PORT=8080 \
LOG_LEVEL=info \
cargo run -p agentscope-api
```

`DATABASE_URL` values that include `channel_binding=...` are supported; that parameter is ignored by SQLx and stripped before connecting.
Startup DB connection includes retry with exponential backoff (`DB_CONNECT_*`).
Runtime transaction start also retries transient connection-loss errors with exponential backoff and a hard timeout (`DB_RUNTIME_*`).

## Run Web

```bash
cd apps/web
npm install
npm run dev
```

Web UI will be available at `http://localhost:3000`.

## Run With Docker

```bash
docker compose -f docker-compose.yml up --build
```

API will be available at `http://localhost:8080` and Postgres at `localhost:5432`.

## Run LLM Proxy

```bash
OPENAI_API_KEY=... \
AGENTSCOPE_API=http://localhost:8080 \
AGENTSCOPE_API_KEY=... \
cargo run -p agentscope-llm-proxy
```

LLM proxy telemetry is sent to `POST /v1/ingest` and requires `AGENTSCOPE_API_KEY`.

## Demo Harness

Examples and demo harness scripts are maintained in a separate demo repository.

## Endpoints

- `POST /v1/ingest`
- `GET /v1/runs`
- `GET /v1/search`
- `GET /v1/runs/{id}`
- `GET /v1/runs/{id}/spans`
- `GET /v1/runs/{id}/metrics`
- `GET /v1/runs/{id}/insights`
- `GET /v1/runs/{id}/root-cause`

## Migrations

Migrations are in `apps/backend/core/storage/migrations` and are executed on server startup.

## Tests

```bash
cargo test -p agentscope-api
```

Tests require `DATABASE_URL` to point to a Postgres instance because integration tests use `sqlx::test`.
