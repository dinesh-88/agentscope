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
├─ packages/
│  └─ python-sdk/
├─ examples/
│  ├─ demo-agent/
│  ├─ rag-agent/
│  └─ tool-agent/
├─ docker/
├─ docs/
│  ├─ architecture.md
│  ├─ telemetry-spec.md
│  └─ engine-spec.md
├─ scripts/
└─ README.md
```

## Run API

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agentscope \
SERVER_PORT=8080 \
LOG_LEVEL=info \
cargo run -p agentscope-api
```

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

## Demo Harness

```bash
make demo
```

Or run directly:

```bash
./examples/demo-agent/run_demo.sh
```

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
