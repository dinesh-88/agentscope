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

- `apps/api/api`: Axum HTTP server and route handlers
- `apps/api/trace`: telemetry models (`Run`, `Span`, `Artifact`, `TelemetryError`)
- `apps/api/storage`: SQLx Postgres implementation and migrations
- `apps/api/workers`: background worker entrypoint + `finalize_run`
- `apps/api/common`: configuration and shared errors
