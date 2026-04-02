CREATE TABLE IF NOT EXISTS weekly_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    total_runs INTEGER NOT NULL DEFAULT 0,
    failure_rate_before DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    failure_rate_after DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    cost_before DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    cost_after DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    improvement_summary TEXT NOT NULL,
    report_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_project_week_start
    ON weekly_reports(project_id, week_start DESC);
