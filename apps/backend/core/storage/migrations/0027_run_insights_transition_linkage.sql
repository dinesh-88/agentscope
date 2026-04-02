ALTER TABLE run_insights
ADD COLUMN IF NOT EXISTS related_transition_from_span_id TEXT,
ADD COLUMN IF NOT EXISTS related_transition_to_span_id TEXT,
ADD COLUMN IF NOT EXISTS cause_confidence TEXT,
ADD COLUMN IF NOT EXISTS derived_from_transition BOOLEAN NOT NULL DEFAULT FALSE;
