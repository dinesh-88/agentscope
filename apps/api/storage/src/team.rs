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
    pub project_id: Option<String>,
    pub organization_id: String,
    pub role: String,
    pub invite_state: String,
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
    pub membership_state: String,
    pub joined_at: DateTime<Utc>,
}

fn normalize_role_for_membership(role: &str) -> Option<&'static str> {
    match role.trim().to_lowercase().as_str() {
        "admin" | "owner" => Some("admin"),
        "member" | "developer" | "viewer" => Some("member"),
        _ => None,
    }
}

fn is_admin_role(role: &str) -> bool {
    matches!(role, "admin" | "owner")
}

impl Storage {
    pub async fn create_invite(
        &self,
        organization_id: &str,
        email: &str,
        role: &str,
        project_id: Option<&str>,
    ) -> Result<InviteRecord, AgentScopeError> {
        let normalized_role = normalize_role_for_membership(role).ok_or_else(|| {
            AgentScopeError::Validation("role must be one of admin or member".to_string())
        })?;
        let normalized_email = email.trim().to_lowercase();
        let token = format!("invite_{}", Uuid::new_v4().simple());
        let expires_at = Utc::now() + Duration::days(7);

        let duplicate_pending_exists = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM invites
                WHERE organization_id = $1::uuid
                  AND lower(email) = $2
                  AND invite_state = 'pending'
                  AND accepted_at IS NULL
                  AND expires_at > now()
            )
            "#,
        )
        .bind(organization_id)
        .bind(&normalized_email)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to validate duplicate invite for organization {organization_id}: {error}"
            ))
        })?;
        if duplicate_pending_exists {
            return Err(AgentScopeError::Validation(
                "an active pending invite already exists for this email".to_string(),
            ));
        }

        let existing_member = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM memberships m
                INNER JOIN users u ON u.id = m.user_id
                WHERE m.organization_id = $1::uuid
                  AND lower(u.email) = $2
            )
            "#,
        )
        .bind(organization_id)
        .bind(&normalized_email)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to validate existing membership for organization {organization_id}: {error}"
            ))
        })?;
        if existing_member {
            return Err(AgentScopeError::Validation(
                "user is already an active organization member".to_string(),
            ));
        }

        let invite = sqlx::query_as::<_, InviteRecord>(
            r#"
            INSERT INTO invites (email, organization_id, project_id, role, invite_state, token, expires_at)
            VALUES ($1, $2::uuid, $3::uuid, $4, 'pending', $5, $6)
            RETURNING id::text AS id,
                      email,
                      project_id::text AS project_id,
                      organization_id::text AS organization_id,
                      role,
                      invite_state,
                      token,
                      expires_at,
                      created_at,
                      accepted_at
            "#,
        )
        .bind(&normalized_email)
        .bind(organization_id)
        .bind(project_id)
        .bind(normalized_role)
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
                   project_id::text AS project_id,
                   organization_id::text AS organization_id,
                   role,
                   invite_state,
                   token,
                   expires_at,
                   created_at,
                   accepted_at
            FROM invites
            WHERE token = $1
              AND invite_state = 'pending'
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

        let membership_role = normalize_role_for_membership(&invite.role).unwrap_or("member");

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
        .bind(membership_role)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to apply membership from invite: {error}"))
        })?;

        sqlx::query(
            "UPDATE invites SET accepted_at = now(), invite_state = 'active' WHERE id = $1::uuid",
        )
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
                   CASE
                       WHEN memberships.role IN ('admin', 'owner') THEN 'admin'
                       ELSE 'member'
                   END AS role,
                   'active'::text AS membership_state,
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
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to start member removal tx: {error}"))
        })?;

        let role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT role
            FROM memberships
            WHERE organization_id = $1::uuid
              AND user_id = $2::uuid
            "#,
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch member role {user_id} in organization {organization_id}: {error}"
            ))
        })?;

        let Some(member_role) = role else {
            tx.rollback().await.ok();
            return Ok(false);
        };

        if is_admin_role(&member_role) {
            let admin_count = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT COUNT(*)
                FROM memberships
                WHERE organization_id = $1::uuid
                  AND role IN ('admin', 'owner')
                "#,
            )
            .bind(organization_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to validate admin count for organization {organization_id}: {error}"
                ))
            })?;

            if admin_count <= 1 {
                tx.rollback().await.ok();
                return Err(AgentScopeError::Validation(
                    "cannot remove the last admin from organization".to_string(),
                ));
            }
        }

        let result = sqlx::query(
            r#"
            DELETE FROM memberships
            WHERE organization_id = $1::uuid
              AND user_id = $2::uuid
            "#,
        )
        .bind(organization_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to remove member {user_id} from organization {organization_id}: {error}"
            ))
        })?;

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to commit member removal tx: {error}"))
        })?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn update_org_member_role(
        &self,
        organization_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<bool, AgentScopeError> {
        let normalized_role = normalize_role_for_membership(role).ok_or_else(|| {
            AgentScopeError::Validation("role must be one of admin or member".to_string())
        })?;
        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to start member role update tx: {error}"))
        })?;

        let current_role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT role
            FROM memberships
            WHERE organization_id = $1::uuid
              AND user_id = $2::uuid
            FOR UPDATE
            "#,
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch current role for user {user_id} in organization {organization_id}: {error}"
            ))
        })?;

        let Some(current_role) = current_role else {
            tx.rollback().await.ok();
            return Ok(false);
        };

        if is_admin_role(&current_role) && normalized_role == "member" {
            let admin_count = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT COUNT(*)
                FROM memberships
                WHERE organization_id = $1::uuid
                  AND role IN ('admin', 'owner')
                "#,
            )
            .bind(organization_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to validate admin count for organization {organization_id}: {error}"
                ))
            })?;
            if admin_count <= 1 {
                tx.rollback().await.ok();
                return Err(AgentScopeError::Validation(
                    "cannot demote the last admin".to_string(),
                ));
            }
        }

        let result = sqlx::query(
            r#"
            UPDATE memberships
            SET role = $3
            WHERE organization_id = $1::uuid
              AND user_id = $2::uuid
            "#,
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(normalized_role)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to update member role for user {user_id} in organization {organization_id}: {error}"
            ))
        })?;

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to commit member role update for organization {organization_id}: {error}"
            ))
        })?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn list_org_pending_invites(
        &self,
        organization_id: &str,
    ) -> Result<Vec<InviteRecord>, AgentScopeError> {
        let invites = sqlx::query_as::<_, InviteRecord>(
            r#"
            SELECT id::text AS id,
                   email,
                   project_id::text AS project_id,
                   organization_id::text AS organization_id,
                   role,
                   invite_state,
                   token,
                   expires_at,
                   created_at,
                   accepted_at
            FROM invites
            WHERE organization_id = $1::uuid
              AND invite_state = 'pending'
              AND accepted_at IS NULL
              AND expires_at > now()
            ORDER BY created_at DESC
            "#,
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to list pending invites for organization {organization_id}: {error}"
            ))
        })?;
        Ok(invites)
    }

    pub async fn resend_org_invite(
        &self,
        organization_id: &str,
        invite_id: &str,
    ) -> Result<Option<InviteRecord>, AgentScopeError> {
        let token = format!("invite_{}", Uuid::new_v4().simple());
        let expires_at = Utc::now() + Duration::days(7);
        let invite = sqlx::query_as::<_, InviteRecord>(
            r#"
            UPDATE invites
            SET token = $3,
                expires_at = $4,
                created_at = now()
            WHERE id = $1::uuid
              AND organization_id = $2::uuid
              AND invite_state = 'pending'
              AND accepted_at IS NULL
            RETURNING id::text AS id,
                      email,
                      project_id::text AS project_id,
                      organization_id::text AS organization_id,
                      role,
                      invite_state,
                      token,
                      expires_at,
                      created_at,
                      accepted_at
            "#,
        )
        .bind(invite_id)
        .bind(organization_id)
        .bind(token)
        .bind(expires_at)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to resend invite {invite_id} in organization {organization_id}: {error}"
            ))
        })?;
        Ok(invite)
    }

    pub async fn cancel_org_invite(
        &self,
        organization_id: &str,
        invite_id: &str,
    ) -> Result<bool, AgentScopeError> {
        let result = sqlx::query(
            r#"
            DELETE FROM invites
            WHERE id = $1::uuid
              AND organization_id = $2::uuid
              AND invite_state = 'pending'
              AND accepted_at IS NULL
            "#,
        )
        .bind(invite_id)
        .bind(organization_id)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to cancel invite {invite_id} in organization {organization_id}: {error}"
            ))
        })?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn get_project_organization_id(
        &self,
        project_id: &str,
    ) -> Result<Option<String>, AgentScopeError> {
        let org_id = sqlx::query_scalar::<_, String>(
            r#"
            SELECT organization_id::text
            FROM projects
            WHERE id = $1::uuid
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to fetch organization for project {project_id}: {error}"
            ))
        })?;
        Ok(org_id)
    }
}
