# Telemetry Spec

The ingestion payload for `POST /v1/ingest`:

```json
{
  "run": { "...": "..." },
  "spans": [{ "...": "..." }],
  "artifacts": [{ "...": "..." }]
}
```

## Run

- `id`
- `project_id`
- `workflow_name`
- `agent_name`
- `status`
- `started_at`
- `ended_at`

## Span

- `id`
- `run_id`
- `parent_span_id`
- `span_type`
- `name`
- `status`
- `started_at`
- `ended_at`

## Artifact

- `id`
- `run_id`
- `span_id`
- `kind`
- `payload`

## Error

- `run_id`
- `span_id`
- `error_type`
- `message`
