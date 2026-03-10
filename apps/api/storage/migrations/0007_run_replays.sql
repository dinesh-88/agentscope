CREATE TABLE IF NOT EXISTS run_replays (
    id UUID PRIMARY KEY,
    original_run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    current_step INTEGER NOT NULL DEFAULT 0,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_replays_original_run_id ON run_replays(original_run_id);
