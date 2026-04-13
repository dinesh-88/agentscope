CREATE TABLE IF NOT EXISTS subscription_run_usage (
    run_id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    usage_month DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_run_usage_project_month
    ON subscription_run_usage(project_id, usage_month DESC);

INSERT INTO subscription_run_usage (run_id, project_id, usage_month)
SELECT runs.id,
       runs.project_id,
       DATE_TRUNC('month', runs.started_at AT TIME ZONE 'UTC')::date
FROM runs
ON CONFLICT (run_id) DO NOTHING;
