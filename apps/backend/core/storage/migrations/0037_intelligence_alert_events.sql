ALTER TABLE alert_events
    ALTER COLUMN alert_id DROP NOT NULL;

ALTER TABLE alert_events
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS type TEXT,
    ADD COLUMN IF NOT EXISTS issue_key TEXT,
    ADD COLUMN IF NOT EXISTS message TEXT,
    ADD COLUMN IF NOT EXISTS severity TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE alert_events
SET created_at = triggered_at
WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_events_project_created
    ON alert_events(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_project_type_created
    ON alert_events(project_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_project_issue_created
    ON alert_events(project_id, issue_key, created_at DESC);
