ALTER TABLE spans
ADD COLUMN IF NOT EXISTS instruction_context JSONB;

CREATE INDEX IF NOT EXISTS idx_spans_instruction_context ON spans USING GIN (instruction_context);
