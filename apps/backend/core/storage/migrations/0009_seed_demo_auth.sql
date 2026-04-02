INSERT INTO users (id, email, password_hash, display_name)
VALUES (
    '00000000-0000-4000-8000-000000000010',
    'owner@demo.agentscope.local',
    crypt('demo-password', gen_salt('bf')),
    'Demo Owner'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO memberships (user_id, organization_id, role)
VALUES (
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000000',
    'owner'
)
ON CONFLICT (user_id, organization_id) DO NOTHING;

INSERT INTO project_api_keys (id, project_id, label, key_hash)
VALUES (
    '00000000-0000-4000-8000-000000000020',
    '00000000-0000-4000-8000-000000000001',
    'demo-sdk-key',
    encode(digest('ags_demo_project_key', 'sha256'), 'hex')
)
ON CONFLICT (key_hash) DO NOTHING;
