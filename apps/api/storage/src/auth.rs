use agentscope_common::errors::AgentScopeError;
use serde::Serialize;
use sqlx::FromRow;

use crate::Storage;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProjectApiKey {
    pub id: String,
    pub project_id: String,
    pub label: String,
}

impl Storage {
    pub async fn authenticate_user(
        &self,
        email: &str,
        password: &str,
    ) -> Result<Option<AuthUser>, AgentScopeError> {
        let user = sqlx::query_as::<_, AuthUser>(
            r#"
            SELECT id::text AS id,
                   email,
                   display_name
            FROM users
            WHERE email = $1
              AND password_hash = crypt($2, password_hash)
            "#,
        )
        .bind(email)
        .bind(password)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to authenticate user {email}: {error}"))
        })?;

        Ok(user)
    }

    pub async fn get_user_by_id(&self, user_id: &str) -> Result<Option<AuthUser>, AgentScopeError> {
        let user = sqlx::query_as::<_, AuthUser>(
            r#"
            SELECT id::text AS id,
                   email,
                   display_name
            FROM users
            WHERE id = $1::uuid
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load user {user_id}: {error}"))
        })?;

        Ok(user)
    }

    pub async fn get_project_api_key(
        &self,
        raw_key: &str,
    ) -> Result<Option<ProjectApiKey>, AgentScopeError> {
        let key = sqlx::query_as::<_, ProjectApiKey>(
            r#"
            SELECT id::text AS id,
                   project_id::text AS project_id,
                   label
            FROM project_api_keys
            WHERE key_hash = encode(digest($1, 'sha256'), 'hex')
            "#,
        )
        .bind(raw_key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to resolve project api key: {error}"))
        })?;

        Ok(key)
    }

    pub async fn touch_project_api_key(&self, key_id: &str) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            UPDATE project_api_keys
            SET last_used_at = now()
            WHERE id = $1::uuid
            "#,
        )
        .bind(key_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to update api key {key_id}: {error}"))
        })?;

        Ok(())
    }

    pub async fn user_has_project_access(
        &self,
        user_id: &str,
        project_id: &str,
    ) -> Result<bool, AgentScopeError> {
        let has_access = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM projects
                INNER JOIN memberships
                    ON memberships.organization_id = projects.organization_id
                WHERE projects.id = $1::uuid
                  AND memberships.user_id = $2::uuid
            )
            "#,
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to verify project access for user {user_id}: {error}"
            ))
        })?;

        Ok(has_access)
    }

    pub async fn user_has_elevated_membership(
        &self,
        user_id: &str,
    ) -> Result<bool, AgentScopeError> {
        let is_elevated = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM memberships
                WHERE user_id = $1::uuid
                  AND role IN ('owner', 'admin')
            )
            "#,
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to verify elevated membership for user {user_id}: {error}"
            ))
        })?;

        Ok(is_elevated)
    }
}
