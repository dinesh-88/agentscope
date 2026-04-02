ALTER TABLE projects
ADD COLUMN IF NOT EXISTS api_key_hash TEXT NULL;

ALTER TABLE runs
ADD COLUMN IF NOT EXISTS organization_id UUID NULL REFERENCES organizations(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS total_input_tokens BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_output_tokens BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_tokens BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0;

UPDATE runs
SET organization_id = projects.organization_id
FROM projects
WHERE projects.id = runs.project_id
  AND runs.organization_id IS NULL;

ALTER TABLE runs
ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE spans
ADD COLUMN IF NOT EXISTS context_window BIGINT NULL,
ADD COLUMN IF NOT EXISTS context_usage_percent DOUBLE PRECISION NULL;

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;

ALTER TABLE memberships
ADD CONSTRAINT memberships_role_check
CHECK (role IN ('owner', 'admin', 'developer', 'viewer', 'member'));

CREATE INDEX IF NOT EXISTS idx_runs_organization_id ON runs(organization_id);

UPDATE projects
SET api_key_hash = keys.key_hash
FROM (
    SELECT DISTINCT ON (project_id) project_id, key_hash
    FROM project_api_keys
    ORDER BY project_id, created_at ASC
) AS keys
WHERE keys.project_id = projects.id
  AND projects.api_key_hash IS NULL;
