-- Backfill cross-run trace linkage metadata for runs that predate SDK linkage fields.

-- Ensure every run has a trace_id for grouping.
UPDATE runs
SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{trace_id}',
    to_jsonb(id::text),
    true
)
WHERE COALESCE(NULLIF(BTRIM(metadata ->> 'trace_id'), ''), '') = '';

-- For top-level runs with no parent, set root_run_id = run.id when missing.
UPDATE runs
SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{root_run_id}',
    to_jsonb(id::text),
    true
)
WHERE COALESCE(NULLIF(BTRIM(metadata ->> 'root_run_id'), ''), '') = ''
  AND COALESCE(NULLIF(BTRIM(metadata ->> 'parent_run_id'), ''), '') = '';

-- Support trace filtering/grouping queries.
CREATE INDEX IF NOT EXISTS idx_runs_trace_id
    ON runs ((metadata ->> 'trace_id'));
