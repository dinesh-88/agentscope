-- Incremental observability refactor for scalability, consistency, and cross-run intelligence.
-- This migration applies additive/compatibility-first changes where possible.

-- -----------------------------------------------------------------------------
-- 0) Safety prerequisites
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure versions exists and agent_id is enforced for downstream FK usage.
CREATE TABLE IF NOT EXISTS versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bootstrap required columns on runs early so downstream partition prep can reference them.
ALTER TABLE runs
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS version_id UUID NULL REFERENCES versions(id) ON DELETE SET NULL;

UPDATE runs
SET created_at = COALESCE(created_at, started_at, now())
WHERE created_at IS NULL;

ALTER TABLE runs
ALTER COLUMN created_at SET NOT NULL,
ALTER COLUMN created_at SET DEFAULT now();

-- Bootstrap failure_events for clean installations where it does not yet exist.
CREATE TABLE IF NOT EXISTS failure_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    span_id UUID NULL REFERENCES spans(id) ON DELETE SET NULL,
    version_id UUID NULL REFERENCES versions(id) ON DELETE SET NULL,
    category TEXT NOT NULL DEFAULT 'unknown',
    subcategory TEXT NOT NULL DEFAULT 'unknown',
    severity TEXT NULL,
    message TEXT NULL,
    metadata JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bootstrap issue_rankings for clean installations before ALTER/INDEX statements below.
CREATE TABLE IF NOT EXISTS issue_rankings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_id UUID NULL REFERENCES versions(id) ON DELETE SET NULL,
    issue_key TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    severity TEXT NOT NULL,
    frequency_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    cost_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    severity_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    priority_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    event_count_30d BIGINT NOT NULL DEFAULT 0,
    affected_run_count_30d BIGINT NOT NULL DEFAULT 0,
    failed_cost_usd_30d DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    rank_position INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NULL,
    last_seen_at TIMESTAMPTZ NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(issue_key)) > 0),
    CHECK (priority_score >= 0.0)
);

-- -----------------------------------------------------------------------------
-- 1) Merge duplicate aggregation tables into one canonical table:
--    failure_metrics_daily
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS failure_metrics_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version_id UUID NULL REFERENCES versions(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    failure_category_id INTEGER NULL,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    failure_key TEXT NOT NULL,
    event_count BIGINT NOT NULL DEFAULT 0,
    affected_run_count BIGINT NOT NULL DEFAULT 0,
    failed_run_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    avg_failed_run_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(category)) > 0),
    CHECK (length(trim(subcategory)) > 0),
    CHECK (length(trim(failure_key)) > 0),
    CHECK (event_count >= 0),
    CHECK (affected_run_count >= 0),
    CHECK (failed_run_cost_usd >= 0.0),
    CHECK (total_tokens >= 0),
    CHECK (avg_failed_run_cost_usd >= 0.0)
);

-- Ingest from failure_metrics_agg_daily when present.
DO $$
BEGIN
    IF to_regclass('public.failure_metrics_agg_daily') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO failure_metrics_daily (
                project_id,
                version_id,
                date,
                category,
                subcategory,
                failure_key,
                event_count,
                affected_run_count,
                failed_run_cost_usd,
                total_tokens,
                avg_failed_run_cost_usd,
                created_at,
                updated_at
            )
            SELECT
                src.project_id,
                src.version_id,
                src.date,
                src.category,
                src.subcategory,
                src.failure_key,
                src.event_count,
                src.affected_run_count,
                src.failed_run_cost_usd,
                src.total_tokens,
                src.avg_failed_run_cost_usd,
                src.created_at,
                src.updated_at
            FROM failure_metrics_agg_daily src
            WHERE NOT EXISTS (
                SELECT 1
                FROM failure_metrics_daily dst
                WHERE dst.project_id = src.project_id
                  AND COALESCE(dst.version_id, '00000000-0000-0000-0000-000000000000'::uuid)
                      = COALESCE(src.version_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  AND dst.date = src.date
                  AND dst.failure_key = src.failure_key
            )
        $sql$;
    END IF;
END $$;

-- Ingest from failure_event_stats_daily when present.
DO $$
BEGIN
    IF to_regclass('public.failure_event_stats_daily') IS NOT NULL THEN
        EXECUTE $sql$
            INSERT INTO failure_metrics_daily (
                project_id,
                version_id,
                date,
                category,
                subcategory,
                failure_key,
                event_count,
                affected_run_count,
                failed_run_cost_usd,
                total_tokens,
                avg_failed_run_cost_usd,
                created_at,
                updated_at
            )
            SELECT
                src.project_id,
                src.version_id,
                src.date,
                src.category,
                src.subcategory,
                src.failure_key,
                src.event_count,
                src.affected_run_count,
                src.failed_run_cost_usd,
                src.total_tokens,
                CASE
                    WHEN src.affected_run_count > 0
                        THEN src.failed_run_cost_usd / src.affected_run_count::double precision
                    ELSE 0.0
                END AS avg_failed_run_cost_usd,
                src.created_at,
                src.updated_at
            FROM failure_event_stats_daily src
            WHERE NOT EXISTS (
                SELECT 1
                FROM failure_metrics_daily dst
                WHERE dst.project_id = src.project_id
                  AND COALESCE(dst.version_id, '00000000-0000-0000-0000-000000000000'::uuid)
                      = COALESCE(src.version_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  AND dst.date = src.date
                  AND dst.failure_key = src.failure_key
            )
        $sql$;
    END IF;
END $$;

DROP TABLE IF EXISTS failure_metrics_agg_daily;
DROP TABLE IF EXISTS failure_event_stats_daily;

CREATE UNIQUE INDEX IF NOT EXISTS uq_failure_metrics_daily_rollup
    ON failure_metrics_daily (
        project_id,
        COALESCE(version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        date,
        failure_key
    );

CREATE INDEX IF NOT EXISTS idx_failure_metrics_daily_project_date
    ON failure_metrics_daily(project_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_failure_metrics_daily_project_version_date
    ON failure_metrics_daily(project_id, version_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_failure_metrics_daily_project_category_subcategory_date
    ON failure_metrics_daily(project_id, category, subcategory, date DESC);

-- -----------------------------------------------------------------------------
-- 2) Add failure taxonomy table and replace free-text category/subcategory in
--    failure_events with failure_category_id
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS failure_categories (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    UNIQUE (category, subcategory)
);

-- Ensure fallback taxonomy entry exists.
INSERT INTO failure_categories (category, subcategory)
VALUES ('unknown', 'unknown')
ON CONFLICT (category, subcategory) DO NOTHING;

ALTER TABLE failure_events
ADD COLUMN IF NOT EXISTS failure_category_id INTEGER;

-- Seed taxonomy from existing free-text columns if they are still present.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'failure_events'
          AND column_name = 'category'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'failure_events'
          AND column_name = 'subcategory'
    ) THEN
        EXECUTE $sql$
            INSERT INTO failure_categories (category, subcategory)
            SELECT DISTINCT
                COALESCE(NULLIF(trim(category), ''), 'unknown') AS category,
                COALESCE(NULLIF(trim(subcategory), ''), 'unknown') AS subcategory
            FROM failure_events
            ON CONFLICT (category, subcategory) DO NOTHING
        $sql$;

        EXECUTE $sql$
            UPDATE failure_events fe
            SET failure_category_id = fc.id
            FROM failure_categories fc
            WHERE fc.category = COALESCE(NULLIF(trim(fe.category), ''), 'unknown')
              AND fc.subcategory = COALESCE(NULLIF(trim(fe.subcategory), ''), 'unknown')
              AND fe.failure_category_id IS NULL
        $sql$;
    END IF;
END $$;

-- Fill any remaining nulls with the fallback taxonomy id.
UPDATE failure_events
SET failure_category_id = (
    SELECT id
    FROM failure_categories
    WHERE category = 'unknown' AND subcategory = 'unknown'
)
WHERE failure_category_id IS NULL;

ALTER TABLE failure_events
ALTER COLUMN failure_category_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'failure_events_failure_category_id_fkey'
    ) THEN
        ALTER TABLE failure_events
        ADD CONSTRAINT failure_events_failure_category_id_fkey
        FOREIGN KEY (failure_category_id) REFERENCES failure_categories(id);
    END IF;
END $$;

-- Drop legacy free-text columns after taxonomy backfill.
ALTER TABLE failure_events
DROP COLUMN IF EXISTS category,
DROP COLUMN IF EXISTS subcategory;

-- -----------------------------------------------------------------------------
-- 3) Add time dimension to issue_rankings snapshots
-- -----------------------------------------------------------------------------
ALTER TABLE issue_rankings
ADD COLUMN IF NOT EXISTS date DATE;

UPDATE issue_rankings
SET date = COALESCE(date, DATE(created_at AT TIME ZONE 'UTC'), CURRENT_DATE)
WHERE date IS NULL;

ALTER TABLE issue_rankings
ALTER COLUMN date SET NOT NULL;

DROP INDEX IF EXISTS uq_issue_rankings_project_version_issue;
CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_rankings_project_version_issue_date
    ON issue_rankings (
        project_id,
        COALESCE(version_id, '00000000-0000-0000-0000-000000000000'::uuid),
        issue_key,
        date
    );

-- -----------------------------------------------------------------------------
-- 4) Add failure_hash UUID for fast grouping and joins
-- -----------------------------------------------------------------------------
ALTER TABLE failure_events
ADD COLUMN IF NOT EXISTS failure_hash UUID;

UPDATE failure_events
SET failure_hash = (
    substr(md5(failure_category_id::text), 1, 8) || '-' ||
    substr(md5(failure_category_id::text), 9, 4) || '-' ||
    substr(md5(failure_category_id::text), 13, 4) || '-' ||
    substr(md5(failure_category_id::text), 17, 4) || '-' ||
    substr(md5(failure_category_id::text), 21, 12)
)::uuid
WHERE failure_hash IS NULL;

ALTER TABLE failure_events
ALTER COLUMN failure_hash SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 5) Normalize runs.status using enum type
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_status_enum') THEN
        CREATE TYPE run_status_enum AS ENUM ('success', 'failed', 'error', 'partial');
    END IF;
END $$;

-- Map legacy/free-form statuses into canonical enum values.
UPDATE runs
SET status = (
    CASE
        WHEN lower(trim(status::text)) IN ('success', 'succeeded', 'ok', 'completed', 'complete') THEN 'success'
        WHEN lower(trim(status::text)) IN ('failed', 'failure') THEN 'failed'
        WHEN lower(trim(status::text)) IN ('error', 'errored') THEN 'error'
        WHEN lower(trim(status::text)) IN ('partial', 'partially_successful', 'partial_success') THEN 'partial'
        ELSE 'partial'
    END
)::run_status_enum
WHERE status::text NOT IN ('success', 'failed', 'error', 'partial');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runs'
          AND column_name = 'status'
          AND udt_name <> 'run_status_enum'
    ) THEN
        ALTER TABLE runs
        ALTER COLUMN status TYPE run_status_enum
        USING status::run_status_enum;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6) Partitioning prep (monthly RANGE via inheritance) for runs/failure_events
--    without table rewrite, preserving existing table names and compatibility.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ensure_runs_month_partition(p_ts timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_start date := date_trunc('month', p_ts)::date;
    v_end date := (date_trunc('month', p_ts) + interval '1 month')::date;
    v_table text := format('runs_%s', to_char(v_start, 'YYYYMM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I (CHECK (created_at >= %L AND created_at < %L)) INHERITS (runs)',
        v_table, v_start, v_end
    );

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (created_at)', v_table || '_created_at_idx', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (version_id)', v_table || '_version_id_idx', v_table);

    RETURN v_table;
END $$;

CREATE OR REPLACE FUNCTION ensure_failure_events_month_partition(p_ts timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_start date := date_trunc('month', p_ts)::date;
    v_end date := (date_trunc('month', p_ts) + interval '1 month')::date;
    v_table text := format('failure_events_%s', to_char(v_start, 'YYYYMM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I (CHECK (created_at >= %L AND created_at < %L)) INHERITS (failure_events)',
        v_table, v_start, v_end
    );

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (created_at)', v_table || '_created_at_idx', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (failure_hash)', v_table || '_failure_hash_idx', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (failure_category_id)', v_table || '_failure_category_id_idx', v_table);

    RETURN v_table;
END $$;

-- Pre-create current and next month partitions for both tables.
SELECT ensure_runs_month_partition(now());
SELECT ensure_runs_month_partition(now() + interval '1 month');
SELECT ensure_failure_events_month_partition(now());
SELECT ensure_failure_events_month_partition(now() + interval '1 month');

-- -----------------------------------------------------------------------------
-- 7) Add sessions table and link runs.session_id as UUID FK
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Convert existing text session_id to UUID where possible; non-UUID strings become NULL.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runs'
          AND column_name = 'session_id'
          AND udt_name <> 'uuid'
    ) THEN
        ALTER TABLE runs
        ALTER COLUMN session_id TYPE UUID
        USING CASE
            WHEN session_id IS NULL THEN NULL
            WHEN session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN session_id::uuid
            ELSE NULL
        END;
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'runs'
          AND column_name = 'session_id'
    ) THEN
        ALTER TABLE runs
        ADD COLUMN session_id UUID NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'runs_session_id_fkey'
    ) THEN
        ALTER TABLE runs
        ADD CONSTRAINT runs_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8) Promote frequently queried metadata to first-class columns
-- -----------------------------------------------------------------------------
ALTER TABLE runs
ADD COLUMN IF NOT EXISTS model_name TEXT,
ADD COLUMN IF NOT EXISTS prompt_hash TEXT;

ALTER TABLE spans
ADD COLUMN IF NOT EXISTS model_name TEXT,
ADD COLUMN IF NOT EXISTS prompt_hash TEXT;

-- Backfill promoted columns from existing fields when available.
UPDATE runs
SET model_name = COALESCE(model_name, NULLIF((metadata ->> 'model_name'), ''))
WHERE model_name IS NULL
  AND metadata IS NOT NULL;

UPDATE spans
SET model_name = COALESCE(model_name, model)
WHERE model_name IS NULL
  AND model IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 9) Required indexing improvements
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_version_id ON runs(version_id);

CREATE INDEX IF NOT EXISTS idx_failure_events_failure_hash
    ON failure_events(failure_hash);

CREATE INDEX IF NOT EXISTS idx_failure_events_failure_category_id
    ON failure_events(failure_category_id);

CREATE INDEX IF NOT EXISTS idx_issue_rankings_date
    ON issue_rankings(date DESC);

-- -----------------------------------------------------------------------------
-- 10) Final correctness fixes: partitioning keys, NOT NULLs, aggregation PK,
--     sessions created_at, versions.agent_id, and required lookup indexes.
-- -----------------------------------------------------------------------------

-- 10.1 Partitioning fix: enforce composite primary keys on inherited partitions.
-- Parent tables are kept compatible; partition children use (id, created_at).
CREATE OR REPLACE FUNCTION ensure_runs_month_partition(p_ts timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_start date := date_trunc('month', p_ts)::date;
    v_end date := (date_trunc('month', p_ts) + interval '1 month')::date;
    v_table text := format('runs_%s', to_char(v_start, 'YYYYMM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I (
            CHECK (created_at >= %L AND created_at < %L),
            PRIMARY KEY (id, created_at)
        ) INHERITS (runs)',
        v_table, v_start, v_end
    );

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (created_at)', v_table || '_created_at_idx', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (version_id)', v_table || '_version_id_idx', v_table);

    RETURN v_table;
END $$;

CREATE OR REPLACE FUNCTION ensure_failure_events_month_partition(p_ts timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_start date := date_trunc('month', p_ts)::date;
    v_end date := (date_trunc('month', p_ts) + interval '1 month')::date;
    v_table text := format('failure_events_%s', to_char(v_start, 'YYYYMM'));
BEGIN
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I (
            CHECK (created_at >= %L AND created_at < %L),
            PRIMARY KEY (id, created_at)
        ) INHERITS (failure_events)',
        v_table, v_start, v_end
    );

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (created_at)', v_table || '_created_at_idx', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (failure_hash)', v_table || '_failure_hash_idx', v_table);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (failure_category_id)', v_table || '_failure_category_id_idx', v_table);

    RETURN v_table;
END $$;

-- 10.2 NOT NULL constraints on required columns.
ALTER TABLE runs
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE runs
SET created_at = COALESCE(created_at, started_at, now())
WHERE created_at IS NULL;

ALTER TABLE runs
ALTER COLUMN status SET NOT NULL,
ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE failure_events
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE failure_events fe
SET created_at = COALESCE(
    fe.created_at,
    (SELECT COALESCE(r.created_at, r.started_at, now()) FROM runs r WHERE r.id = fe.run_id),
    now()
)
WHERE fe.created_at IS NULL;

ALTER TABLE failure_events
ALTER COLUMN run_id SET NOT NULL,
ALTER COLUMN failure_category_id SET NOT NULL,
ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE issue_rankings
ALTER COLUMN issue_key SET NOT NULL,
ALTER COLUMN priority_score SET NOT NULL,
ALTER COLUMN date SET NOT NULL;

-- 10.3 Aggregation table fix:
-- Ensure failure_metrics_daily uses (date, version_id, failure_category_id) as PK.
ALTER TABLE failure_metrics_daily
ADD COLUMN IF NOT EXISTS failure_category_id INTEGER;

INSERT INTO failure_categories (category, subcategory)
VALUES ('unknown', 'unknown')
ON CONFLICT (category, subcategory) DO NOTHING;

UPDATE failure_metrics_daily fmd
SET failure_category_id = fc.id
FROM failure_categories fc
WHERE fc.category = COALESCE(NULLIF(trim(fmd.category), ''), 'unknown')
  AND fc.subcategory = COALESCE(NULLIF(trim(fmd.subcategory), ''), 'unknown')
  AND fmd.failure_category_id IS NULL;

ALTER TABLE versions
ADD COLUMN IF NOT EXISTS agent_id UUID;

UPDATE versions
SET agent_id = COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid)
WHERE agent_id IS NULL;

ALTER TABLE versions
ALTER COLUMN agent_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM versions WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
    ) THEN
        INSERT INTO versions (id, agent_id, created_at)
        VALUES (
            '00000000-0000-0000-0000-000000000000'::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid,
            now()
        );
    END IF;
END $$;

UPDATE failure_metrics_daily
SET version_id = '00000000-0000-0000-0000-000000000000'::uuid
WHERE version_id IS NULL;

UPDATE failure_metrics_daily
SET failure_category_id = (
    SELECT id FROM failure_categories WHERE category = 'unknown' AND subcategory = 'unknown'
)
WHERE failure_category_id IS NULL;

ALTER TABLE failure_metrics_daily
ALTER COLUMN version_id SET NOT NULL,
ALTER COLUMN failure_category_id SET NOT NULL;

-- Consolidate potential duplicate rows before adding the new composite PK.
CREATE TEMP TABLE _failure_metrics_daily_repr AS
SELECT DISTINCT ON (date, version_id, failure_category_id)
    id,
    project_id,
    version_id,
    date,
    failure_category_id,
    category,
    subcategory,
    failure_key,
    created_at,
    updated_at
FROM failure_metrics_daily
ORDER BY date, version_id, failure_category_id, created_at ASC, id ASC;

CREATE TEMP TABLE _failure_metrics_daily_metrics AS
SELECT
    version_id,
    date,
    failure_category_id,
    sum(event_count) AS event_count,
    sum(affected_run_count) AS affected_run_count,
    sum(failed_run_cost_usd) AS failed_run_cost_usd,
    sum(total_tokens) AS total_tokens,
    CASE
        WHEN sum(affected_run_count) > 0
            THEN sum(failed_run_cost_usd) / sum(affected_run_count)::double precision
        ELSE 0.0
    END AS avg_failed_run_cost_usd,
    min(created_at) AS created_at,
    max(updated_at) AS updated_at
FROM failure_metrics_daily
GROUP BY date, version_id, failure_category_id;

TRUNCATE TABLE failure_metrics_daily;

INSERT INTO failure_metrics_daily (
    id,
    project_id,
    version_id,
    date,
    failure_category_id,
    category,
    subcategory,
    failure_key,
    event_count,
    affected_run_count,
    failed_run_cost_usd,
    total_tokens,
    avg_failed_run_cost_usd,
    created_at,
    updated_at
)
SELECT
    r.id,
    r.project_id,
    m.version_id,
    m.date,
    m.failure_category_id,
    r.category,
    r.subcategory,
    r.failure_key,
    m.event_count,
    m.affected_run_count,
    m.failed_run_cost_usd,
    m.total_tokens,
    m.avg_failed_run_cost_usd,
    m.created_at,
    m.updated_at
FROM _failure_metrics_daily_repr r
JOIN _failure_metrics_daily_metrics m
  ON r.date = m.date
 AND r.version_id = m.version_id
 AND r.failure_category_id = m.failure_category_id;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'failure_metrics_daily_pkey'
    ) THEN
        ALTER TABLE failure_metrics_daily DROP CONSTRAINT failure_metrics_daily_pkey;
    END IF;
END $$;

ALTER TABLE failure_metrics_daily
ADD CONSTRAINT failure_metrics_daily_pkey
PRIMARY KEY (date, version_id, failure_category_id);

-- 10.4 Sessions table fix: created_at with default now().
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 10.5 Required indexes for hash/category-time/ranking lookups.
CREATE INDEX IF NOT EXISTS idx_failure_events_hash
ON failure_events (failure_hash);

CREATE INDEX IF NOT EXISTS idx_failure_events_category_time
ON failure_events (failure_category_id, created_at);

CREATE INDEX IF NOT EXISTS idx_issue_rankings_lookup
ON issue_rankings (project_id, version_id, date);

-- -----------------------------------------------------------------------------
-- 11) Final production-readiness hardening
-- -----------------------------------------------------------------------------

-- 11.1 Default partitions (critical safety for partitioned parents).
-- Create default partitions only when parent tables are declarative partitioned tables.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'runs'::regclass AND relkind = 'p') THEN
        IF to_regclass('public.runs_default') IS NULL THEN
            EXECUTE 'CREATE TABLE runs_default PARTITION OF runs DEFAULT';
        END IF;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'failure_events'::regclass AND relkind = 'p') THEN
        IF to_regclass('public.failure_events_default') IS NULL THEN
            EXECUTE 'CREATE TABLE failure_events_default PARTITION OF failure_events DEFAULT';
        END IF;
    END IF;
END $$;

-- 11.2 Foreign key indexes (performance for common joins).
CREATE INDEX IF NOT EXISTS idx_spans_run_id ON spans(run_id);
CREATE INDEX IF NOT EXISTS idx_failure_events_run_id ON failure_events(run_id);
DO $$
BEGIN
    -- Backward compatibility:
    -- use run_insights when legacy "insights" table does not exist.
    IF to_regclass('public.insights') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_insights_run_id ON insights(run_id)';
    ELSIF to_regclass('public.run_insights') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_run_insights_run_id_obs ON run_insights(run_id)';
    END IF;
END $$;

-- 11.3 failure_events run-time composite index.
CREATE INDEX IF NOT EXISTS idx_failure_events_run_time
ON failure_events (run_id, created_at);

-- 11.4 issue_rankings prioritization sort index.
CREATE INDEX IF NOT EXISTS idx_issue_rankings_priority
ON issue_rankings (date, priority_score DESC);

-- 11.5 failure_hash documentation.
-- failure_hash should be a deterministic hash of:
-- (failure_category_id + subcategory + optional features)
-- Generated at application layer.
COMMENT ON COLUMN failure_events.failure_hash IS
'Deterministic hash key for failure grouping/joining (built from taxonomy and optional features in application layer).';

-- 11.6 Aggregation table clarity (separation of concerns).
DO $$
BEGIN
    IF to_regclass('public.run_stats_daily') IS NOT NULL THEN
        EXECUTE $c$
            COMMENT ON TABLE run_stats_daily IS
            'Overall system/run aggregate metrics (volume, tokens, cost, success/failure rates), not failure-taxonomy specific.'
        $c$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.failure_metrics_daily') IS NOT NULL THEN
        EXECUTE $c$
            COMMENT ON TABLE failure_metrics_daily IS
            'Failure-specific daily aggregates (event counts, impacted runs, failed cost impact, and token impact by failure taxonomy).'
        $c$;
    END IF;
END $$;

-- 11.7 Data retention note on raw tables.
DO $$
BEGIN
    IF to_regclass('public.runs') IS NOT NULL THEN
        EXECUTE $c$
            COMMENT ON TABLE runs IS
            'NOTE: runs, spans, and failure_events should support a data retention / cleanup strategy (TTL and/or archiving).'
        $c$;
    END IF;
    IF to_regclass('public.spans') IS NOT NULL THEN
        EXECUTE $c$
            COMMENT ON TABLE spans IS
            'NOTE: runs, spans, and failure_events should support a data retention / cleanup strategy (TTL and/or archiving).'
        $c$;
    END IF;
    IF to_regclass('public.failure_events') IS NOT NULL THEN
        EXECUTE $c$
            COMMENT ON TABLE failure_events IS
            'NOTE: runs, spans, and failure_events should support a data retention / cleanup strategy (TTL and/or archiving).'
        $c$;
    END IF;
END $$;

-- 11.8 Multi-tenancy prep: ensure project_id exists and is indexed on key tables.
ALTER TABLE runs ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE failure_events ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE issue_rankings ADD COLUMN IF NOT EXISTS project_id UUID;

-- Backfill project_id where missing to preserve query correctness.
UPDATE failure_events fe
SET project_id = r.project_id
FROM runs r
WHERE fe.run_id = r.id
  AND fe.project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_runs_project_id ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_failure_events_project_id ON failure_events(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_rankings_project_id ON issue_rankings(project_id);
