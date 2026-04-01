-- Cross-run aggregated issue insights.
-- This table is intentionally separate from run_insights (per-run scope).

CREATE TABLE IF NOT EXISTS issue_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity dimensions for issue-level aggregation snapshots.
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_id UUID NULL REFERENCES versions(id) ON DELETE SET NULL,
    issue_key TEXT NOT NULL,
    date DATE NOT NULL,

    -- Aggregated insight payload for the issue on a given date.
    summary TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    recommended_fix TEXT NOT NULL,
    expected_impact TEXT NOT NULL,
    confidence_score DOUBLE PRECISION NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (length(trim(issue_key)) > 0),
    CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0)
);

-- Prevent duplicate issue insight snapshots per project/version/issue/date.
CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_insights_project_version_issue_date
    ON issue_insights (
        project_id,
        COALESCE(version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        issue_key,
        date
    );

-- Read-path indexes for common drilldowns.
CREATE INDEX IF NOT EXISTS idx_issue_insights_project_date
    ON issue_insights(project_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_issue_insights_issue_key
    ON issue_insights(issue_key);
