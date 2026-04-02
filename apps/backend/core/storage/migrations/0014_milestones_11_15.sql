CREATE TABLE IF NOT EXISTS project_usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, date)
);

CREATE INDEX IF NOT EXISTS idx_project_usage_daily_project_date
    ON project_usage_daily(project_id, date DESC);

CREATE TABLE IF NOT EXISTS project_limits (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    max_runs_per_minute INTEGER NULL,
    max_tokens_per_day INTEGER NULL,
    max_concurrent_runs INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_usage_realtime (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    current_runs INTEGER NOT NULL DEFAULT 0,
    tokens_today BIGINT NOT NULL DEFAULT 0,
    last_reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    condition_type TEXT NOT NULL,
    threshold_value DOUBLE PRECISION NOT NULL,
    window_minutes INTEGER NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_project_id
    ON alerts(project_id);

CREATE TABLE IF NOT EXISTS alert_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_alert_events_alert_id_triggered
    ON alert_events(alert_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_org_id
    ON invites(organization_id);
CREATE INDEX IF NOT EXISTS idx_invites_token
    ON invites(token);

ALTER TABLE oauth_providers
ADD COLUMN IF NOT EXISTS issuer_url TEXT NULL;
