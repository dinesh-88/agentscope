use agentscope_common::errors::AgentScopeError;
use sqlx::{postgres::PgPoolOptions, PgPool, Postgres, Transaction};
use std::{env, time::Duration};
use tokio::time::sleep;
use tracing::{info, warn};

#[derive(Clone)]
pub struct Storage {
    pub pool: PgPool,
}

impl Storage {
    pub async fn connect(database_url: &str) -> Result<Self, AgentScopeError> {
        let max_connections = env_u32("DB_POOL_MAX_CONNECTIONS", 10).max(1);
        let min_connections = env_u32("DB_POOL_MIN_CONNECTIONS", 0).min(max_connections);
        let acquire_timeout = Duration::from_secs(env_u64("DB_POOL_ACQUIRE_TIMEOUT_SECONDS", 10));
        let idle_timeout = Duration::from_secs(env_u64("DB_POOL_IDLE_TIMEOUT_SECONDS", 300));
        let max_lifetime = Duration::from_secs(env_u64("DB_POOL_MAX_LIFETIME_SECONDS", 1800));
        let connect_retry_settings = RetrySettings::from_env(
            "DB_CONNECT_RETRIES",
            5,
            "DB_CONNECT_RETRY_BASE_MILLIS",
            500,
            "DB_CONNECT_RETRY_MAX_MILLIS",
            5_000,
        );
        let sanitized_database_url = sanitize_database_url(database_url);

        let mut last_error = None;
        for attempt in 0..=connect_retry_settings.retries {
            match PgPoolOptions::new()
                .max_connections(max_connections)
                .min_connections(min_connections)
                .acquire_timeout(acquire_timeout)
                .idle_timeout(idle_timeout)
                .max_lifetime(max_lifetime)
                .connect(&sanitized_database_url)
                .await
            {
                Ok(pool) => {
                    info!(
                        max_connections,
                        min_connections,
                        acquire_timeout_seconds = acquire_timeout.as_secs(),
                        idle_timeout_seconds = idle_timeout.as_secs(),
                        max_lifetime_seconds = max_lifetime.as_secs(),
                        connect_max_attempts = connect_retry_settings.retries + 1,
                        "database connection established"
                    );
                    return Ok(Self { pool });
                }
                Err(error) => {
                    last_error = Some(error);
                    if attempt == connect_retry_settings.retries {
                        break;
                    }

                    let delay = connect_retry_settings.delay_for(attempt);
                    warn!(
                        attempt = attempt + 1,
                        max_attempts = connect_retry_settings.retries + 1,
                        retry_in_ms = delay.as_millis() as u64,
                        "failed to connect to postgres, retrying"
                    );
                    sleep(delay).await;
                }
            }
        }

        let last_error = last_error.expect("last_error should be set when retries are exhausted");
        Err(AgentScopeError::Storage(format!(
            "failed to connect to postgres after {} attempts: {last_error}",
            connect_retry_settings.retries + 1
        )))
    }

    pub async fn run_migrations(&self) -> Result<(), AgentScopeError> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(|error| AgentScopeError::Storage(format!("migration failed: {error}")))?;
        info!("database migrations completed");
        Ok(())
    }

    pub async fn begin_tx(&self) -> Result<Transaction<'_, Postgres>, AgentScopeError> {
        let runtime_retry_settings = RetrySettings::from_env(
            "DB_RUNTIME_RETRY_ATTEMPTS",
            6,
            "DB_RUNTIME_RETRY_BASE_MILLIS",
            200,
            "DB_RUNTIME_RETRY_MAX_MILLIS",
            2_000,
        );
        let runtime_retry_timeout =
            Duration::from_secs(env_u64("DB_RUNTIME_RETRY_TIMEOUT_SECONDS", 20));

        let started_at = tokio::time::Instant::now();
        let mut attempts = 0u32;

        loop {
            match self.pool.begin().await {
                Ok(tx) => return Ok(tx),
                Err(error) => {
                    attempts += 1;
                    let elapsed = started_at.elapsed();
                    let timed_out = elapsed >= runtime_retry_timeout;
                    let retryable = is_retryable_connection_error(&error);

                    if !retryable || timed_out || attempts > runtime_retry_settings.retries + 1 {
                        return Err(AgentScopeError::Storage(format!(
                            "failed to start database transaction after {attempts} attempt(s) in {}ms: {error}",
                            elapsed.as_millis()
                        )));
                    }

                    let remaining = runtime_retry_timeout.saturating_sub(elapsed);
                    let delay = runtime_retry_settings.delay_for(attempts - 1).min(remaining);
                    if delay.is_zero() {
                        return Err(AgentScopeError::Storage(format!(
                            "failed to start database transaction after {attempts} attempt(s) in {}ms: {error}",
                            elapsed.as_millis()
                        )));
                    }

                    warn!(
                        attempt = attempts,
                        max_attempts = runtime_retry_settings.retries + 1,
                        elapsed_ms = elapsed.as_millis() as u64,
                        retry_in_ms = delay.as_millis() as u64,
                        timeout_ms = runtime_retry_timeout.as_millis() as u64,
                        "failed to start database transaction, retrying"
                    );
                    sleep(delay).await;
                }
            }
        }
    }
}

#[derive(Copy, Clone)]
struct RetrySettings {
    retries: u32,
    base_delay_millis: u64,
    max_delay_millis: u64,
}

impl RetrySettings {
    fn from_env(
        retries_var: &str,
        default_retries: u32,
        base_delay_var: &str,
        default_base_delay_millis: u64,
        max_delay_var: &str,
        default_max_delay_millis: u64,
    ) -> Self {
        let retries = env_u32(retries_var, default_retries);
        let base_delay_millis = env_u64(base_delay_var, default_base_delay_millis).max(1);
        let max_delay_millis = env_u64(max_delay_var, default_max_delay_millis).max(base_delay_millis);
        Self {
            retries,
            base_delay_millis,
            max_delay_millis,
        }
    }

    fn delay_for(&self, attempt: u32) -> Duration {
        let shift = attempt.min(20);
        let exponential = self.base_delay_millis.saturating_mul(1_u64 << shift);
        Duration::from_millis(exponential.min(self.max_delay_millis))
    }
}

fn env_u32(name: &str, default: u32) -> u32 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(default)
}

fn env_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default)
}

fn sanitize_database_url(database_url: &str) -> String {
    let (base, query) = match database_url.split_once('?') {
        Some(parts) => parts,
        None => return database_url.to_string(),
    };

    let params: Vec<&str> = query
        .split('&')
        .filter(|segment| {
            segment
                .split_once('=')
                .map_or(!segment.eq_ignore_ascii_case("channel_binding"), |(key, _)| {
                    !key.eq_ignore_ascii_case("channel_binding")
                })
        })
        .collect();

    if params.len() == query.split('&').count() {
        return database_url.to_string();
    }

    if params.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", params.join("&"))
    }
}

fn is_retryable_connection_error(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::Io(_)
        | sqlx::Error::PoolTimedOut
        | sqlx::Error::PoolClosed
        | sqlx::Error::Tls(_) => true,
        sqlx::Error::Database(database_error) => {
            let code = database_error
                .code()
                .map(|value| value.to_string())
                .unwrap_or_default();
            matches!(
                code.as_str(),
                "08000"
                    | "08001"
                    | "08003"
                    | "08006"
                    | "57P01"
                    | "57P02"
                    | "57P03"
                    | "53300"
            )
        }
        _ => {
            let message = error.to_string().to_lowercase();
            message.contains("eof")
                || message.contains("connection reset")
                || message.contains("broken pipe")
                || message.contains("connection refused")
                || message.contains("connection closed")
                || message.contains("timed out")
        }
    }
}
