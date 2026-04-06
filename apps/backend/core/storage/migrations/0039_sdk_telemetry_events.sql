CREATE TABLE IF NOT EXISTS telemetry_events (
    id BIGSERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    event TEXT NOT NULL,
    sdk TEXT NOT NULL,
    sdk_version TEXT NOT NULL,
    runtime TEXT NOT NULL,
    env TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    error_type TEXT NULL,
    CHECK (event IN ('sdk_init', 'run_start', 'run_end')),
    CHECK (sdk IN ('python', 'ts')),
    CHECK (env IN ('dev', 'prod'))
);

CREATE INDEX IF NOT EXISTS idx_telemetry_events_timestamp ON telemetry_events("timestamp");
CREATE INDEX IF NOT EXISTS idx_telemetry_events_project_id ON telemetry_events(project_id);
