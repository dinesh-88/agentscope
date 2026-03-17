ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_span_id_fkey;
ALTER TABLE artifacts DROP CONSTRAINT IF EXISTS artifacts_run_id_fkey;
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_parent_span_id_fkey;
ALTER TABLE spans DROP CONSTRAINT IF EXISTS spans_run_id_fkey;
ALTER TABLE run_insights DROP CONSTRAINT IF EXISTS run_insights_run_id_fkey;
ALTER TABLE run_root_causes DROP CONSTRAINT IF EXISTS run_root_causes_run_id_fkey;
ALTER TABLE run_replays DROP CONSTRAINT IF EXISTS run_replays_original_run_id_fkey;
ALTER TABLE run_analysis DROP CONSTRAINT IF EXISTS run_analysis_run_id_fkey;

ALTER TABLE runs
    ALTER COLUMN id TYPE TEXT USING id::text;

ALTER TABLE spans
    ALTER COLUMN id TYPE TEXT USING id::text,
    ALTER COLUMN run_id TYPE TEXT USING run_id::text,
    ALTER COLUMN parent_span_id TYPE TEXT USING parent_span_id::text;

ALTER TABLE artifacts
    ALTER COLUMN id TYPE TEXT USING id::text,
    ALTER COLUMN run_id TYPE TEXT USING run_id::text,
    ALTER COLUMN span_id TYPE TEXT USING span_id::text;

ALTER TABLE run_insights
    ALTER COLUMN run_id TYPE TEXT USING run_id::text;

ALTER TABLE run_root_causes
    ALTER COLUMN run_id TYPE TEXT USING run_id::text;

ALTER TABLE run_replays
    ALTER COLUMN original_run_id TYPE TEXT USING original_run_id::text;

ALTER TABLE run_analysis
    ALTER COLUMN run_id TYPE TEXT USING run_id::text;

ALTER TABLE spans
    ADD CONSTRAINT spans_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    ADD CONSTRAINT spans_parent_span_id_fkey
        FOREIGN KEY (parent_span_id) REFERENCES spans(id) ON DELETE SET NULL;

ALTER TABLE artifacts
    ADD CONSTRAINT artifacts_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    ADD CONSTRAINT artifacts_span_id_fkey
        FOREIGN KEY (span_id) REFERENCES spans(id) ON DELETE CASCADE;

ALTER TABLE run_insights
    ADD CONSTRAINT run_insights_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;

ALTER TABLE run_root_causes
    ADD CONSTRAINT run_root_causes_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;

ALTER TABLE run_replays
    ADD CONSTRAINT run_replays_original_run_id_fkey
        FOREIGN KEY (original_run_id) REFERENCES runs(id) ON DELETE CASCADE;

ALTER TABLE run_analysis
    ADD CONSTRAINT run_analysis_run_id_fkey
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE;
