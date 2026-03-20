CREATE TABLE IF NOT EXISTS run_explanations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    top_issue TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    next_action TEXT NOT NULL,
    recommended_order JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_explanations_run_id
ON run_explanations (run_id);

CREATE TABLE IF NOT EXISTS trend_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    "window" TEXT NOT NULL,
    summary TEXT NOT NULL,
    trends JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_reports_project_id_created_at
ON trend_reports (project_id, created_at DESC);
