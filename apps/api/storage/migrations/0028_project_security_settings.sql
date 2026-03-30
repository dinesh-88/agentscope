ALTER TABLE project_storage_settings
ADD COLUMN IF NOT EXISTS redact_sensitive_data BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS require_authentication BOOLEAN NOT NULL DEFAULT true;
