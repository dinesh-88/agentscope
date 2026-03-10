# AgentScope Engine Spec

AgentScope engine is the Rust backend responsible for telemetry ingestion and querying.

## Scope

- Ingestion API: `POST /v1/ingest`
- Query API: `GET /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/spans`, `GET /v1/runs/{id}/metrics`, `GET /v1/runs/{id}/insights`, `GET /v1/runs/{id}/root-cause`
- Postgres storage with migrations
- Worker operations: `finalize_run`, `prompt_analyzer`, `rca_analyzer`

## Environment Variables

- `DATABASE_URL`
- `SERVER_PORT` (default: `3000`)
- `LOG_LEVEL` (default: `info`)

## Crates

- `engine/api`: Axum HTTP server and route handlers
- `engine/trace`: telemetry models (`Run`, `Span`, `Artifact`, `TelemetryError`)
- `engine/storage`: SQLx Postgres implementation and migrations
- `engine/workers`: background worker entrypoint + `finalize_run`
- `engine/common`: configuration and shared errors
