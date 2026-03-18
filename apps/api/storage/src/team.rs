use agentscope_common::errors::AgentScopeError;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::Storage;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InviteRecord {
    pub id: String,
    pub email: String,
    pub organization_id: String,
    pub role: String,
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub accepted_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TeamMember {
    pub user_id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub role: String,
    pub joined_at: DateTime<Utc>,
}

impl Storage {
    pub async fn create_invite(
        &self,
        organization_id: &str,
        email: &str,
        role: &str,
    ) -> Result<InviteRecord, AgentScopeError> {
        let token = format!("invite_{}", Uuid::new_v4().simple());
        let expires_at = Utc::now() + Duration::days(7);

        let invite = sqlx::query_as::<_, InviteRecord>(
            r#"
            INSERT INTO invites (email, organization_id, role, token, expires_at)
            VALUES ($1, $2::uuid, $3, $4, $5)
            RETURNING id::text AS id,
                      email,
                      organization_id::text AS organization_id,
                      role,
                      token,
                      expires_at,
                      created_at,
                      accepted_at
            "#,
        )
        .bind(email)
        .bind(organization_id)
        .bind(role)
        .bind(&token)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create invite for organization {organization_id}: {error}"
            ))
        })?;

        Ok(invite)
    }

    pub async fn accept_invite(
        &self,
        token: &str,
        user_id: &str,
        user_email: &str,
    ) -> Result<Option<InviteRecord>, AgentScopeError> {
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to start invite acceptance tx: {error}"))
        })?;

        let invite = sqlx::query_as::<_, InviteRecord>(
            r#"
            SELECT id::text AS id,
                   email,
                   organization_id::text AS organization_id,
                   role,
                   token,
                   expires_at,
                   created_at,
                   accepted_at
            FROM invites
            WHERE token = $1
              AND accepted_at IS NULL
              AND expires_at > now()
            "#,
        )
        .bind(token)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to fetch invite token: {error}"))
        })?;

        let Some(invite) = invite else {
            tx.rollback().await.ok();
            return Ok(None);
        };

        if invite.email.to_lowercase() != user_email.to_lowercase() {
            tx.rollback().await.ok();
            return Ok(None);
        }

        sqlx::query(
            r#"
            INSERT INTO memberships (user_id, organization_id, role)
            VALUES ($1::uuid, $2::uuid, $3)
            ON CONFLICT (user_id, organization_id) DO UPDATE
            SET role = EXCLUDED.role
            "#,
        )
        .bind(user_id)
        .bind(&invite.organization_id)
        .bind(&invite.role)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to apply membership from invite: {error}"))
        })?;

        sqlx::query("UPDATE invites SET accepted_at = now() WHERE id = $1::uuid")
            .bind(&invite.id)
            .execute(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!("failed to mark invite as accepted: {error}"))
            })?;

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to commit invite acceptance: {error}"))
        })?;

        Ok(Some(invite))
    }

    pub async fn list_org_members(
        &self,
        organization_id: &str,
    ) -> Result<Vec<TeamMember>, AgentScopeError> {
        let members = sqlx::query_as::<_, TeamMember>(
            r#"
            SELECT memberships.user_id::text AS user_id,
                   users.email,
                   COALESCE(users.name, users.display_name) AS display_name,
                   memberships.role,
                   memberships.created_at AS joined_at
            FROM memberships
            INNER JOIN users ON users.id = memberships.user_id
            WHERE memberships.organization_id = $1::uuid
            ORDER BY memberships.created_at ASC
            "#,
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list members for organization {organization_id}: {error}"
            ))
        })?;

        Ok(members)
    }

    pub async fn remove_org_member(
        &self,
        organization_id: &str,
        user_id: &str,
    ) -> Result<bool, AgentScopeError> {
        let result = sqlx::query(
            r#"
            DELETE FROM memberships
            WHERE organization_id = $1::uuid
              AND user_id = $2::uuid
            "#,
        )
        .bind(organization_id)
        .bind(user_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to remove member {user_id} from organization {organization_id}: {error}"
            ))
        })?;

        Ok(result.rows_affected() > 0)
    }
}
