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
- `provider` (optional)
- `model` (optional)
- `input_tokens` (optional)
- `output_tokens` (optional)
- `total_tokens` (optional)
- `estimated_cost` (optional)

## Run Metrics

- `input_tokens`
- `output_tokens`
- `total_tokens`
- `estimated_cost`

## Run Insight

- `id`
- `run_id`
- `insight_type`
- `severity`
- `message`
- `recommendation`
- `created_at`

## Run Root Cause

- `id`
- `run_id`
- `root_cause_type`
- `confidence`
- `message`
- `evidence`
- `suggested_fix`
- `created_at`

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
