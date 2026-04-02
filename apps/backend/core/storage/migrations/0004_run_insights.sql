CREATE TABLE IF NOT EXISTS run_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    insight_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_insights_run_id ON run_insights(run_id);
