# Architecture

AgentScope v0.1 architecture:

```text
Application
  -> SDK
  -> Ingestion API
  -> Postgres
  -> Query API
```

Telemetry entities:

- runs
- spans
- artifacts
- errors

Current implementation focuses only on telemetry ingestion, storage, and query.
