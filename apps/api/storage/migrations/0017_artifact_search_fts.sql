ALTER TABLE artifacts
ADD COLUMN IF NOT EXISTS tsv tsvector;

UPDATE artifacts
SET tsv = to_tsvector('english', COALESCE(payload::text, ''))
WHERE tsv IS NULL;

CREATE INDEX IF NOT EXISTS idx_artifacts_tsv ON artifacts USING GIN(tsv);

CREATE OR REPLACE FUNCTION artifacts_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.payload::text, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tsv_update ON artifacts;

CREATE TRIGGER tsv_update
BEFORE INSERT OR UPDATE OF payload ON artifacts
FOR EACH ROW EXECUTE FUNCTION artifacts_tsv_trigger();

CREATE INDEX IF NOT EXISTS idx_spans_model ON spans(model);
CREATE INDEX IF NOT EXISTS idx_spans_type ON spans(span_type);
CREATE INDEX IF NOT EXISTS idx_spans_error_type ON spans(error_type);
CREATE INDEX IF NOT EXISTS idx_runs_tags ON runs USING GIN(tags);
