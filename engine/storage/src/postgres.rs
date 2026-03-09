use agentscope_common::errors::AgentScopeError;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

#[derive(Clone)]
pub struct Storage {
    pub pool: PgPool,
}

impl Storage {
    pub async fn connect(database_url: &str) -> Result<Self, AgentScopeError> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(database_url)
            .await
            .map_err(|e| AgentScopeError::Storage(format!("failed to connect to postgres: {e}")))?;

        info!("database connection established");
        Ok(Self { pool })
    }

    pub async fn run_migrations(&self) -> Result<(), AgentScopeError> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(|e| AgentScopeError::Storage(format!("migration failed: {e}")))?;
        info!("database migrations completed");
        Ok(())
    }
}
