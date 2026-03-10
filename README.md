# AgentScope Engine

Rust implementation of AgentScope telemetry ingestion and query engine.

## Repository Layout

```text
agentscope/
├─ Cargo.toml
├─ engine/
│  ├─ api/
│  ├─ trace/
│  ├─ storage/
│  ├─ workers/
│  └─ common/
├─ docs/
│  ├─ architecture.md
│  ├─ telemetry-spec.md
│  └─ engine-spec.md
└─ README.md
```

## Run API

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/agentscope \
SERVER_PORT=8080 \
LOG_LEVEL=info \
cargo run -p agentscope-api
```

## Run With Docker

```bash
docker compose up --build
```

API will be available at `http://localhost:8080` and Postgres at `localhost:5432`.

## Demo Harness

```bash
make demo
```

Or run directly:

```bash
./examples/demo/run_demo.sh
```

## Endpoints

- `POST /v1/ingest`
- `GET /v1/runs`
- `GET /v1/runs/{id}`
- `GET /v1/runs/{id}/spans`
- `GET /v1/runs/{id}/metrics`
- `GET /v1/runs/{id}/insights`
- `GET /v1/runs/{id}/root-cause`

## Migrations

Migrations are in `engine/storage/migrations` and are executed on server startup.

## Tests

```bash
cargo test -p agentscope-api
```

Tests require `DATABASE_URL` to point to a Postgres instance because integration tests use `sqlx::test`.
