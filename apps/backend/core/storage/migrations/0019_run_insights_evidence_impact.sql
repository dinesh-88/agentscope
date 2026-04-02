ALTER TABLE run_insights
ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS impact_score DOUBLE PRECISION NOT NULL DEFAULT 0.0;

CREATE INDEX IF NOT EXISTS idx_run_insights_run_id_impact_score
ON run_insights (run_id, impact_score DESC);
