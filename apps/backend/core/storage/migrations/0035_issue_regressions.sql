CREATE TABLE IF NOT EXISTS issue_regressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    baseline_frequency DOUBLE PRECISION NOT NULL,
    current_frequency DOUBLE PRECISION NOT NULL,
    regression_severity DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, issue_key, detected_at)
);

CREATE INDEX IF NOT EXISTS idx_issue_regressions_project_detected
    ON issue_regressions(project_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_issue_regressions_issue_key
    ON issue_regressions(issue_key);
