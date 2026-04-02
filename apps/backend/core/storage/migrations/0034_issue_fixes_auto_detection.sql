ALTER TABLE issue_fixes
ADD COLUMN IF NOT EXISTS auto_detected BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS detection_confidence DOUBLE PRECISION NULL,
ADD COLUMN IF NOT EXISTS baseline_frequency DOUBLE PRECISION NULL,
ADD COLUMN IF NOT EXISTS current_frequency DOUBLE PRECISION NULL;

CREATE INDEX IF NOT EXISTS idx_issue_fixes_auto_detected
    ON issue_fixes(project_id, auto_detected);
