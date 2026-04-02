ALTER TABLE runs
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_runs_deleted_at ON runs(deleted_at);

CREATE TABLE IF NOT EXISTS project_storage_settings (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    retention_days INTEGER NULL,
    store_prompts_responses BOOLEAN NOT NULL DEFAULT true,
    compress_old_runs BOOLEAN NOT NULL DEFAULT false,
    cleanup_mode TEXT NOT NULL DEFAULT 'soft_delete',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (cleanup_mode IN ('soft_delete', 'hard_delete')),
    CHECK (retention_days IS NULL OR retention_days >= 1)
);
