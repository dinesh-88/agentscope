CREATE TABLE IF NOT EXISTS run_root_causes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    root_cause_type TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    message TEXT NOT NULL,
    evidence JSONB NOT NULL,
    suggested_fix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_root_causes_run_id ON run_root_causes(run_id);
