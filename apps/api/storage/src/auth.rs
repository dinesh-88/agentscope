use agentscope_common::errors::AgentScopeError;
use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

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

#[derive(Debug, Clone, Serialize)]
pub struct RegisteredAccount {
    pub user: AuthUser,
    pub organization_id: String,
    pub organization_name: String,
    pub project_id: String,
    pub project_name: String,
    pub api_key: String,
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

    pub async fn register_account(
        &self,
        email: &str,
        password: &str,
        display_name: Option<&str>,
        organization_name: &str,
        project_name: &str,
    ) -> Result<RegisteredAccount, AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to start registration transaction: {error}"))
        })?;

        let user = sqlx::query_as::<_, AuthUser>(
            r#"
            INSERT INTO users (email, password_hash, display_name)
            VALUES ($1, crypt($2, gen_salt('bf')), $3)
            RETURNING id::text AS id,
                      email,
                      display_name
            "#,
        )
        .bind(email)
        .bind(password)
        .bind(display_name)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                AgentScopeError::Validation(format!("user with email {email} already exists"))
            } else {
                AgentScopeError::Storage(format!("failed to create user {email}: {error}"))
            }
        })?;

        let organization_id: String =
            sqlx::query_scalar("INSERT INTO organizations (name) VALUES ($1) RETURNING id::text")
                .bind(organization_name)
                .fetch_one(&mut *tx)
                .await
                .map_err(|error| {
                    AgentScopeError::Storage(format!(
                        "failed to create organization {organization_name}: {error}"
                    ))
                })?;

        let project_id: String = sqlx::query_scalar(
            "INSERT INTO projects (organization_id, name) VALUES ($1::uuid, $2) RETURNING id::text",
        )
        .bind(&organization_id)
        .bind(project_name)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to create project {project_name}: {error}"))
        })?;

        sqlx::query(
            "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1::uuid, $2::uuid, 'owner')",
        )
        .bind(&user.id)
        .bind(&organization_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create owner membership for user {}: {error}",
                user.id
            ))
        })?;

        let raw_api_key = format!("ags_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());

        sqlx::query(
            r#"
            INSERT INTO project_api_keys (project_id, label, key_hash)
            VALUES ($1::uuid, 'default-sdk-key', encode(digest($2, 'sha256'), 'hex'))
            "#,
        )
        .bind(&project_id)
        .bind(&raw_api_key)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create default api key for project {project_id}: {error}"
            ))
        })?;

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to commit registration transaction: {error}"))
        })?;

        Ok(RegisteredAccount {
            user,
            organization_id,
            organization_name: organization_name.to_string(),
            project_id,
            project_name: project_name.to_string(),
            api_key: raw_api_key,
        })
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

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database_error) if database_error.code().as_deref() == Some("23505")
    )
}
