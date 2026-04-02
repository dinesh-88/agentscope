-- Team membership hardening: normalize roles to admin/member and track invite state.

-- Normalize historical membership roles into admin/member.
UPDATE memberships
SET role = CASE
    WHEN role IN ('owner', 'admin') THEN 'admin'
    ELSE 'member'
END;

ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE memberships
    ADD CONSTRAINT memberships_role_check
    CHECK (role IN ('admin', 'member'));

-- Add explicit invite state and optional project ownership context.
ALTER TABLE invites
    ADD COLUMN IF NOT EXISTS project_id UUID NULL REFERENCES projects(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS invite_state TEXT NOT NULL DEFAULT 'pending';

-- Normalize historical invite roles and states.
UPDATE invites
SET role = CASE
    WHEN role IN ('owner', 'admin') THEN 'admin'
    ELSE 'member'
END;

UPDATE invites
SET invite_state = CASE
    WHEN accepted_at IS NULL THEN 'pending'
    ELSE 'active'
END;

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites
    ADD CONSTRAINT invites_role_check
    CHECK (role IN ('admin', 'member'));

ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_state_check;
ALTER TABLE invites
    ADD CONSTRAINT invites_state_check
    CHECK (invite_state IN ('pending', 'active'));

-- Keep only one pending invite per organization/email pair.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY organization_id, lower(email)
               ORDER BY created_at DESC, id DESC
           ) AS row_num
    FROM invites
    WHERE invite_state = 'pending'
)
DELETE FROM invites i
USING ranked r
WHERE i.id = r.id
  AND r.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invites_org_email_pending
    ON invites (organization_id, lower(email))
    WHERE invite_state = 'pending';

CREATE INDEX IF NOT EXISTS idx_invites_org_state
    ON invites (organization_id, invite_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invites_project_state
    ON invites (project_id, invite_state, created_at DESC);
