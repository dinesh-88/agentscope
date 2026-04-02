ALTER TABLE users
ADD COLUMN IF NOT EXISTS name TEXT NULL,
ADD COLUMN IF NOT EXISTS avatar_url TEXT NULL,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE users
SET name = COALESCE(name, display_name)
WHERE name IS NULL
  AND display_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    access_token TEXT NULL,
    refresh_token TEXT NULL,
    token_expires_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_passwords (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO user_passwords (user_id, password_hash, created_at)
SELECT id, password_hash, created_at
FROM users
WHERE password_hash IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT NULL,
    user_agent TEXT NULL,
    bootstrap_api_key TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_pkey;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE memberships
SET id = gen_random_uuid()
WHERE id IS NULL;
ALTER TABLE memberships ALTER COLUMN id SET NOT NULL;
ALTER TABLE memberships ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_user_org_unique
    ON memberships(user_id, organization_id);

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships
ADD CONSTRAINT memberships_role_check
CHECK (role IN ('owner', 'admin', 'developer', 'viewer'));

UPDATE memberships
SET role = 'developer'
WHERE role = 'member';

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_workflow_name ON runs(workflow_name);
CREATE INDEX IF NOT EXISTS idx_runs_agent_name ON runs(agent_name);
