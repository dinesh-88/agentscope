CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
    status TEXT NOT NULL,
    stripe_customer_id TEXT NULL,
    stripe_subscription_id TEXT NULL,
    current_period_start TIMESTAMPTZ NULL,
    current_period_end TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id),
    UNIQUE (stripe_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_org_id
    ON subscriptions(organization_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer_id
    ON subscriptions(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
    ON subscriptions(status);

INSERT INTO subscriptions (organization_id, plan, status)
SELECT o.id, 'free', 'active'
FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id
);
