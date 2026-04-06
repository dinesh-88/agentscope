-- Run manually against your AgentScope database to promote an existing user.
-- Replace the email before running.
UPDATE users
SET role = 'super_admin',
    updated_at = now()
WHERE email = 'admin@example.com';
