ALTER TABLE run_insights
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_run_insights_run_id_primary
ON run_insights (run_id, is_primary);
