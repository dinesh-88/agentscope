# 📦 AgentScope Search V1 — Implementation Spec

## 🎯 Goal
Provide fast search across runs, spans, and artifacts using:
- structured filters
- full-text search (Postgres FTS)

---

## 🧱 Database Changes

### Add full-text column
ALTER TABLE artifacts ADD COLUMN tsv tsvector;

### Populate existing data
UPDATE artifacts
SET tsv = to_tsvector('english', coalesce(content, ''));

### Create index
CREATE INDEX idx_artifacts_tsv ON artifacts USING GIN(tsv);

### Trigger function
CREATE FUNCTION artifacts_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

### Attach trigger
CREATE TRIGGER tsv_update
BEFORE INSERT OR UPDATE ON artifacts
FOR EACH ROW EXECUTE FUNCTION artifacts_tsv_trigger();

### Structured indexes
CREATE INDEX idx_spans_error_type ON spans(error_type);
CREATE INDEX idx_spans_model ON spans(model);
CREATE INDEX idx_spans_type ON spans(span_type);
CREATE INDEX idx_runs_tags ON runs USING GIN(tags);

---

## ⚙️ API Design

Endpoint:
GET /v1/search

Query params:
- query
- error_type
- model
- span_type
- tags[]
- limit
- offset

---

## 🧠 Query Execution

### Full-text match
SELECT id, span_id, ts_rank(tsv, plainto_tsquery($1)) AS rank
FROM artifacts
WHERE tsv @@ plainto_tsquery($1);

### Join
SELECT
  a.id AS artifact_id,
  s.id AS span_id,
  r.id AS run_id,
  s.span_type,
  s.error_type,
  s.model,
  r.tags,
  ts_rank(a.tsv, plainto_tsquery($1)) AS rank
FROM artifacts a
JOIN spans s ON a.span_id = s.id
JOIN runs r ON s.run_id = r.id
WHERE a.tsv @@ plainto_tsquery($1);

### Filters
AND ($2::text IS NULL OR s.error_type = $2)
AND ($3::text IS NULL OR s.model = $3)
AND ($4::text IS NULL OR s.span_type = $4)
AND ($5::text[] IS NULL OR r.tags && $5);

### Order + pagination
ORDER BY rank DESC
LIMIT $limit OFFSET $offset;

---

## 📦 Response Format

{
  "results": [
    {
      "run_id": "uuid",
      "span_id": "uuid",
      "artifact_id": "uuid",
      "span_type": "llm_call",
      "error_type": "invalid_json",
      "model": "gpt-4o",
      "snippet": "...invalid JSON near...",
      "rank": 0.82
    }
  ],
  "total": 100
}

---

## ✂️ Snippet Generation
Use:
ts_headline('english', content, plainto_tsquery($1))

---

## 🖥️ Frontend

- search input (debounced)
- filters (error_type, model, span_type, tags)
- results list
- click → open trace

---

## ⚡ Performance

- use GIN index
- limit results
- avoid full scans

---

## 🔒 Validation

- max query length
- limit ≤ 100
- sanitize input

---

## ✅ Success Criteria

- search works for errors, prompts, responses
- fast (<300ms)
- filters + text work together
