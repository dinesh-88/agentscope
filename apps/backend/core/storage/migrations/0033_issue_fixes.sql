CREATE TABLE IF NOT EXISTS issue_fixes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    fixed_at TIMESTAMPTZ NOT NULL,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, issue_key),
    CHECK (length(trim(issue_key)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_issue_fixes_project_fixed_at
    ON issue_fixes(project_id, fixed_at DESC);

CREATE INDEX IF NOT EXISTS idx_issue_fixes_issue_key
    ON issue_fixes(issue_key);

CREATE INDEX IF NOT EXISTS idx_failure_metrics_daily_failure_key
    ON failure_metrics_daily(failure_key);
