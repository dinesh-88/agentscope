CREATE TABLE IF NOT EXISTS active_alerts (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_active_alerts_project_created
    ON active_alerts(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_active_alerts_project_type
    ON active_alerts(project_id, alert_type);

CREATE TABLE IF NOT EXISTS failure_clusters (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cluster_key TEXT NOT NULL,
    error_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    sample_run_ids TEXT[] NOT NULL DEFAULT '{}',
    common_span TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failure_clusters_project_count
    ON failure_clusters(project_id, count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_failure_clusters_project_key
    ON failure_clusters(project_id, cluster_key);
