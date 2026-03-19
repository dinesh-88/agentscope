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
- `user_id` (optional)
- `session_id` (optional)
- `environment` (optional: `prod | staging | dev`)
- `workflow_name`
- `agent_name`
- `status`
- `started_at`
- `ended_at`
- `experiment_id` (optional)
- `variant` (optional)
- `tags` (optional `string[]`)
- `success_rate` (computed)
- `error_count` (computed)
- `avg_latency_ms` (computed)
- `p95_latency_ms` (computed)

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
- `latency_ms` (optional, auto-derived)
- `error_type` (optional: `invalid_json | rate_limit | timeout | tool_error | unknown`)
- `error_source` (optional: `provider | tool | system`)
- `retryable` (optional)
- `prompt_hash` (optional SHA256)
- `prompt_template_id` (optional)
- `retry_attempt` (optional)
- `max_attempts` (optional)
- `tool_name` (optional)
- `tool_version` (optional)
- `tool_latency_ms` (optional)
- `tool_success` (optional)
- `evaluation` (optional JSON)

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
