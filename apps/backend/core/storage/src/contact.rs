use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::Storage;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NewContactRequest {
    pub email: String,
    pub message: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, FromRow)]
pub struct ContactRequestRecord {
    pub id: Uuid,
    pub email: String,
    pub message: String,
    pub run_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl Storage {
    pub async fn insert_contact_request(
        &self,
        payload: &NewContactRequest,
    ) -> Result<ContactRequestRecord, AgentScopeError> {
        sqlx::query_as::<_, ContactRequestRecord>(
            r#"
            INSERT INTO contact_requests (
                email,
                message,
                run_id
            )
            VALUES ($1, $2, $3)
            RETURNING
                id,
                email,
                message,
                run_id,
                created_at
            "#,
        )
        .bind(&payload.email)
        .bind(&payload.message)
        .bind(&payload.run_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to insert contact request: {error}"))
        })
    }

    pub async fn list_contact_requests(
        &self,
        limit: i64,
    ) -> Result<Vec<ContactRequestRecord>, AgentScopeError> {
        sqlx::query_as::<_, ContactRequestRecord>(
            r#"
            SELECT
                id,
                email,
                message,
                run_id,
                created_at
            FROM contact_requests
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to list contact requests: {error}"))
        })
    }
}
