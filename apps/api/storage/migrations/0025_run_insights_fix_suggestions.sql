ALTER TABLE run_insights
ADD COLUMN IF NOT EXISTS fix_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb;
