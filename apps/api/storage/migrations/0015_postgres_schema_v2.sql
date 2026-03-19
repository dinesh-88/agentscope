ALTER TABLE runs
ADD COLUMN IF NOT EXISTS user_id TEXT,
ADD COLUMN IF NOT EXISTS session_id TEXT,
ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'prod',
ADD COLUMN IF NOT EXISTS success BOOLEAN,
ADD COLUMN IF NOT EXISTS error_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_latency_ms FLOAT,
ADD COLUMN IF NOT EXISTS p95_latency_ms FLOAT,
ADD COLUMN IF NOT EXISTS success_rate FLOAT,
ADD COLUMN IF NOT EXISTS tags TEXT[],
ADD COLUMN IF NOT EXISTS experiment_id TEXT,
ADD COLUMN IF NOT EXISTS variant TEXT,
ADD COLUMN IF NOT EXISTS metadata JSONB;

ALTER TABLE spans
ADD COLUMN IF NOT EXISTS latency_ms FLOAT,
ADD COLUMN IF NOT EXISTS success BOOLEAN,
ADD COLUMN IF NOT EXISTS error_type TEXT,
ADD COLUMN IF NOT EXISTS error_source TEXT,
ADD COLUMN IF NOT EXISTS retryable BOOLEAN,
ADD COLUMN IF NOT EXISTS prompt_hash TEXT,
ADD COLUMN IF NOT EXISTS prompt_template_id TEXT,
ADD COLUMN IF NOT EXISTS temperature FLOAT,
ADD COLUMN IF NOT EXISTS top_p FLOAT,
ADD COLUMN IF NOT EXISTS max_tokens INT,
ADD COLUMN IF NOT EXISTS retry_attempt INT,
ADD COLUMN IF NOT EXISTS max_attempts INT,
ADD COLUMN IF NOT EXISTS tool_name TEXT,
ADD COLUMN IF NOT EXISTS tool_version TEXT,
ADD COLUMN IF NOT EXISTS tool_latency_ms FLOAT,
ADD COLUMN IF NOT EXISTS tool_success BOOLEAN,
ADD COLUMN IF NOT EXISTS evaluation JSONB;

CREATE TABLE IF NOT EXISTS span_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    span_id UUID NOT NULL,
    depends_on_span_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT now(),
    FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE,
    FOREIGN KEY (depends_on_span_id) REFERENCES spans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID,
    span_id UUID,
    evaluator_type TEXT,
    metric_name TEXT,
    score FLOAT,
    success BOOLEAN,
    reason TEXT,
    created_at TIMESTAMP DEFAULT now(),
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE
);

ALTER TABLE artifacts
ADD COLUMN IF NOT EXISTS kind TEXT,
ADD COLUMN IF NOT EXISTS size_bytes INT,
ADD COLUMN IF NOT EXISTS mime_type TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_experiment ON runs(experiment_id, variant);

CREATE INDEX IF NOT EXISTS idx_spans_run_id ON spans(run_id);
CREATE INDEX IF NOT EXISTS idx_spans_type ON spans(span_type);
CREATE INDEX IF NOT EXISTS idx_spans_error_type ON spans(error_type);
CREATE INDEX IF NOT EXISTS idx_spans_prompt_hash ON spans(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_spans_evaluation ON spans USING GIN (evaluation);

CREATE INDEX IF NOT EXISTS idx_artifacts_kind ON artifacts(kind);
