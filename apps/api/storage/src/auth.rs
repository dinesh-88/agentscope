use agentscope_common::errors::AgentScopeError;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Utc};
use rand_core::OsRng;
use serde::Serialize;
use sqlx::{FromRow, Row};
use uuid::Uuid;

use crate::Storage;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
pub struct ProjectApiKey {
    pub id: String,
    pub project_id: String,
    pub organization_id: String,
    pub label: String,
}

#[derive(Debug, Clone, FromRow)]
pub struct UserSession {
    pub id: String,
    pub user_id: String,
    pub session_token: String,
    pub expires_at: DateTime<Utc>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub bootstrap_api_key: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MembershipRecord {
    pub id: String,
    pub organization_id: String,
    pub organization_name: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct OauthProviderRecord {
    pub provider: String,
    pub client_id: String,
    pub client_secret: String,
    pub redirect_uri: String,
    pub issuer_url: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct UserIdentityRecord {
    pub id: String,
    pub user_id: String,
    pub provider: String,
    pub provider_user_id: String,
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

#[derive(Debug, Clone, Serialize)]
pub struct OnboardingState {
    pub has_organization: bool,
    pub has_project: bool,
    pub has_first_run: bool,
    pub default_project_id: Option<String>,
    pub generated_api_key: Option<String>,
}

impl Storage {
    pub async fn authenticate_user(
        &self,
        email: &str,
        password: &str,
    ) -> Result<Option<AuthUser>, AgentScopeError> {
        let record = sqlx::query(
            r#"
            SELECT users.id::text AS id,
                   users.email,
                   COALESCE(users.name, users.display_name) AS display_name,
                   users.avatar_url,
                   user_passwords.password_hash AS modern_password_hash,
                   users.password_hash AS legacy_password_hash
            FROM users
            LEFT JOIN user_passwords
                ON user_passwords.user_id = users.id
            WHERE users.email = $1
            "#,
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to authenticate user {email}: {error}"))
        })?;

        let Some(record) = record else {
            return Ok(None);
        };

        let modern_verified = record
            .get::<Option<String>, _>("modern_password_hash")
            .as_deref()
            .map(|hash| verify_argon2_password(hash, password))
            .transpose()?
            .unwrap_or(false);

        let legacy_verified = if modern_verified {
            false
        } else {
            sqlx::query_scalar::<_, bool>(
                r#"
                SELECT EXISTS (
                    SELECT 1
                    FROM users
                    WHERE email = $1
                      AND password_hash = crypt($2, password_hash)
                )
                "#,
            )
            .bind(email)
            .bind(password)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to verify legacy password for user {email}: {error}"
                ))
            })?
        };

        if !(modern_verified || legacy_verified) {
            return Ok(None);
        }

        if legacy_verified {
            self.upsert_password_hash(&record.get::<String, _>("id"), &hash_password(password)?)
                .await?;
        }

        Ok(Some(AuthUser {
            id: record.get("id"),
            email: record.get("email"),
            display_name: record.get("display_name"),
            avatar_url: record.get("avatar_url"),
        }))
    }

    pub async fn get_user_by_id(&self, user_id: &str) -> Result<Option<AuthUser>, AgentScopeError> {
        let user = sqlx::query_as::<_, AuthUser>(
            r#"
            SELECT id::text AS id,
                   email,
                   COALESCE(name, display_name) AS display_name,
                   avatar_url
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

    pub async fn find_user_by_email(
        &self,
        email: &str,
    ) -> Result<Option<AuthUser>, AgentScopeError> {
        let user = sqlx::query_as::<_, AuthUser>(
            r#"
            SELECT id::text AS id,
                   email,
                   COALESCE(name, display_name) AS display_name,
                   avatar_url
            FROM users
            WHERE email = $1
            "#,
        )
        .bind(email)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load user by email {email}: {error}"))
        })?;

        Ok(user)
    }

    pub async fn create_user(
        &self,
        email: &str,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<AuthUser, AgentScopeError> {
        // Keep a non-null legacy password hash for databases that still enforce
        // users.password_hash NOT NULL, while modern auth uses user_passwords.
        let legacy_password_hash = hash_password(&Uuid::new_v4().to_string())?;

        let user = sqlx::query_as::<_, AuthUser>(
            r#"
            INSERT INTO users (email, password_hash, name, display_name, avatar_url, updated_at)
            VALUES ($1, $2, $3, $3, $4, now())
            RETURNING id::text AS id,
                      email,
                      COALESCE(name, display_name) AS display_name,
                      avatar_url
            "#,
        )
        .bind(email)
        .bind(&legacy_password_hash)
        .bind(display_name)
        .bind(avatar_url)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            if is_unique_violation(&error) {
                AgentScopeError::Validation(format!("user with email {email} already exists"))
            } else {
                AgentScopeError::Storage(format!("failed to create user {email}: {error}"))
            }
        })?;

        Ok(user)
    }

    pub async fn upsert_password_hash(
        &self,
        user_id: &str,
        password_hash: &str,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO user_passwords (user_id, password_hash)
            VALUES ($1::uuid, $2)
            ON CONFLICT (user_id) DO UPDATE
            SET password_hash = EXCLUDED.password_hash
            "#,
        )
        .bind(user_id)
        .bind(password_hash)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert password for user {user_id}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn find_identity(
        &self,
        provider: &str,
        provider_user_id: &str,
    ) -> Result<Option<UserIdentityRecord>, AgentScopeError> {
        let identity = sqlx::query_as::<_, UserIdentityRecord>(
            r#"
            SELECT id::text AS id,
                   user_id::text AS user_id,
                   provider,
                   provider_user_id
            FROM user_identities
            WHERE provider = $1
              AND provider_user_id = $2
            "#,
        )
        .bind(provider)
        .bind(provider_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load identity {provider}/{provider_user_id}: {error}"
            ))
        })?;

        Ok(identity)
    }

    pub async fn upsert_identity(
        &self,
        user_id: &str,
        provider: &str,
        provider_user_id: &str,
        access_token: Option<&str>,
        refresh_token: Option<&str>,
        token_expires_at: Option<DateTime<Utc>>,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO user_identities (
                user_id,
                provider,
                provider_user_id,
                access_token,
                refresh_token,
                token_expires_at,
                updated_at
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6, now())
            ON CONFLICT (provider, provider_user_id) DO UPDATE
            SET user_id = EXCLUDED.user_id,
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                updated_at = now()
            "#,
        )
        .bind(user_id)
        .bind(provider)
        .bind(provider_user_id)
        .bind(access_token)
        .bind(refresh_token)
        .bind(token_expires_at)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert identity {provider}/{provider_user_id}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn upsert_oauth_provider(
        &self,
        provider: &str,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
        issuer_url: Option<&str>,
        enabled: bool,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO oauth_providers (
                provider,
                client_id,
                client_secret,
                redirect_uri,
                issuer_url,
                enabled,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, now())
            ON CONFLICT (provider) DO UPDATE
            SET client_id = EXCLUDED.client_id,
                client_secret = EXCLUDED.client_secret,
                redirect_uri = EXCLUDED.redirect_uri,
                issuer_url = EXCLUDED.issuer_url,
                enabled = EXCLUDED.enabled,
                updated_at = now()
            "#,
        )
        .bind(provider)
        .bind(client_id)
        .bind(client_secret)
        .bind(redirect_uri)
        .bind(issuer_url)
        .bind(enabled)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to upsert oauth provider {provider}: {error}"
            ))
        })?;

        Ok(())
    }

    pub async fn get_oauth_provider(
        &self,
        provider: &str,
    ) -> Result<Option<OauthProviderRecord>, AgentScopeError> {
        let record = sqlx::query_as::<_, OauthProviderRecord>(
            r#"
            SELECT provider, client_id, client_secret, redirect_uri, issuer_url, enabled
            FROM oauth_providers
            WHERE provider = $1
            "#,
        )
        .bind(provider)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!("failed to load oauth provider {provider}: {error}"))
        })?;

        Ok(record)
    }

    pub async fn register_account(
        &self,
        email: &str,
        password: &str,
        display_name: Option<&str>,
        organization_name: &str,
        project_name: &str,
    ) -> Result<RegisteredAccount, AgentScopeError> {
        let user = self.create_user(email, display_name, None).await?;
        self.upsert_password_hash(&user.id, &hash_password(password)?)
            .await?;
        self.ensure_default_workspace(&user.id, organization_name, project_name)
            .await
    }

    pub async fn create_session(
        &self,
        user_id: &str,
        session_token: &str,
        expires_at: DateTime<Utc>,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
        bootstrap_api_key: Option<&str>,
    ) -> Result<UserSession, AgentScopeError> {
        let session = sqlx::query_as::<_, UserSession>(
            r#"
            INSERT INTO sessions (
                user_id,
                session_token,
                expires_at,
                ip_address,
                user_agent,
                bootstrap_api_key
            )
            VALUES ($1::uuid, $2, $3, $4, $5, $6)
            RETURNING id::text AS id,
                      user_id::text AS user_id,
                      session_token,
                      expires_at,
                      ip_address,
                      user_agent,
                      bootstrap_api_key,
                      created_at
            "#,
        )
        .bind(user_id)
        .bind(session_token)
        .bind(expires_at)
        .bind(ip_address)
        .bind(user_agent)
        .bind(bootstrap_api_key)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create session for user {user_id}: {error}"
            ))
        })?;

        Ok(session)
    }

    pub async fn get_session(
        &self,
        session_token: &str,
    ) -> Result<Option<UserSession>, AgentScopeError> {
        let session = sqlx::query_as::<_, UserSession>(
            r#"
            SELECT id::text AS id,
                   user_id::text AS user_id,
                   session_token,
                   expires_at,
                   ip_address,
                   user_agent,
                   bootstrap_api_key,
                   created_at
            FROM sessions
            WHERE session_token = $1
              AND expires_at > now()
            "#,
        )
        .bind(session_token)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| AgentScopeError::Storage(format!("failed to load session: {error}")))?;

        Ok(session)
    }

    pub async fn delete_session(&self, session_token: &str) -> Result<(), AgentScopeError> {
        sqlx::query("DELETE FROM sessions WHERE session_token = $1")
            .bind(session_token)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!("failed to delete session: {error}"))
            })?;

        Ok(())
    }

    pub async fn get_memberships_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<MembershipRecord>, AgentScopeError> {
        let memberships = sqlx::query_as::<_, MembershipRecord>(
            r#"
            SELECT memberships.id::text AS id,
                   memberships.organization_id::text AS organization_id,
                   organizations.name AS organization_name,
                   memberships.role,
                   memberships.created_at
            FROM memberships
            INNER JOIN organizations
                ON organizations.id = memberships.organization_id
            WHERE memberships.user_id = $1::uuid
            ORDER BY memberships.created_at ASC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load memberships for user {user_id}: {error}"
            ))
        })?;

        Ok(memberships)
    }

    pub async fn get_role_for_organization(
        &self,
        user_id: &str,
        organization_id: &str,
    ) -> Result<Option<String>, AgentScopeError> {
        let role = sqlx::query_scalar::<_, String>(
            r#"
            SELECT role
            FROM memberships
            WHERE user_id = $1::uuid
              AND organization_id = $2::uuid
            "#,
        )
        .bind(user_id)
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load membership for user {user_id} in organization {organization_id}: {error}"
            ))
        })?;

        Ok(role)
    }

    pub async fn get_project_api_key(
        &self,
        raw_key: &str,
    ) -> Result<Option<ProjectApiKey>, AgentScopeError> {
        let key = sqlx::query_as::<_, ProjectApiKey>(
            r#"
            SELECT project_api_keys.id::text AS id,
                   project_api_keys.project_id::text AS project_id,
                   projects.organization_id::text AS organization_id,
                   project_api_keys.label
            FROM project_api_keys
            INNER JOIN projects
                ON projects.id = project_api_keys.project_id
            WHERE project_api_keys.key_hash = encode(digest($1, 'sha256'), 'hex')
               OR projects.api_key_hash = encode(digest($1, 'sha256'), 'hex')
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

    pub async fn ensure_default_workspace(
        &self,
        user_id: &str,
        organization_name: &str,
        project_name: &str,
    ) -> Result<RegisteredAccount, AgentScopeError> {
        let existing = self.get_default_project_for_user(user_id).await?;
        if let Some((organization_id, organization_name, project_id, project_name)) = existing {
            let user = self
                .get_user_by_id(user_id)
                .await?
                .ok_or_else(|| AgentScopeError::Storage(format!("user {user_id} not found")))?;

            return Ok(RegisteredAccount {
                user,
                organization_id,
                organization_name,
                project_id: project_id.clone(),
                project_name,
                api_key: self.create_bootstrap_api_key(&project_id).await?,
            });
        }

        let mut tx = self.pool.begin().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to start onboarding transaction: {error}"))
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
        .bind(user_id)
        .bind(&organization_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create owner membership for user {user_id}: {error}"
            ))
        })?;

        let raw_api_key = generate_project_api_key();
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

        sqlx::query(
            r#"
            UPDATE projects
            SET api_key_hash = encode(digest($2, 'sha256'), 'hex')
            WHERE id = $1::uuid
            "#,
        )
        .bind(&project_id)
        .bind(&raw_api_key)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to persist project api key hash for project {project_id}: {error}"
            ))
        })?;

        tx.commit().await.map_err(|error| {
            AgentScopeError::Storage(format!("failed to commit onboarding transaction: {error}"))
        })?;

        let user = self
            .get_user_by_id(user_id)
            .await?
            .ok_or_else(|| AgentScopeError::Storage(format!("user {user_id} not found")))?;

        Ok(RegisteredAccount {
            user,
            organization_id,
            organization_name: organization_name.to_string(),
            project_id,
            project_name: project_name.to_string(),
            api_key: raw_api_key,
        })
    }

    pub async fn create_bootstrap_api_key(
        &self,
        project_id: &str,
    ) -> Result<String, AgentScopeError> {
        let raw_key = generate_project_api_key();
        self.create_project_api_key(project_id, "onboarding-key", &raw_key)
            .await?;
        Ok(raw_key)
    }

    pub async fn get_default_project_for_user(
        &self,
        user_id: &str,
    ) -> Result<Option<(String, String, String, String)>, AgentScopeError> {
        let record = sqlx::query(
            r#"
            SELECT organizations.id::text AS organization_id,
                   organizations.name AS organization_name,
                   projects.id::text AS project_id,
                   projects.name AS project_name
            FROM memberships
            INNER JOIN organizations
                ON organizations.id = memberships.organization_id
            INNER JOIN projects
                ON projects.organization_id = organizations.id
            WHERE memberships.user_id = $1::uuid
            ORDER BY memberships.created_at ASC, projects.created_at ASC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to load default project for user {user_id}: {error}"
            ))
        })?;

        Ok(record.map(|row| {
            (
                row.get("organization_id"),
                row.get("organization_name"),
                row.get("project_id"),
                row.get("project_name"),
            )
        }))
    }

    pub async fn get_onboarding_state(
        &self,
        user_id: &str,
        session_token: Option<&str>,
    ) -> Result<OnboardingState, AgentScopeError> {
        let default_project = self.get_default_project_for_user(user_id).await?;
        let has_organization = default_project.is_some();
        let has_project = default_project.is_some();
        let default_project_id = default_project
            .as_ref()
            .map(|(_, _, project_id, _)| project_id.clone());

        let has_first_run = if let Some(project_id) = default_project_id.as_deref() {
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS (SELECT 1 FROM runs WHERE project_id = $1::uuid)",
            )
            .bind(project_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to load run state for project {project_id}: {error}"
                ))
            })?
        } else {
            false
        };

        let generated_api_key = if let Some(token) = session_token {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT bootstrap_api_key FROM sessions WHERE session_token = $1",
            )
            .bind(token)
            .fetch_one(&self.pool)
            .await
            .map_err(|error| {
                AgentScopeError::Storage(format!(
                    "failed to load onboarding api key from session: {error}"
                ))
            })?
        } else {
            None
        };

        Ok(OnboardingState {
            has_organization,
            has_project,
            has_first_run,
            default_project_id,
            generated_api_key,
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

    pub async fn create_project_api_key(
        &self,
        project_id: &str,
        label: &str,
        raw_key: &str,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            WITH inserted AS (
                INSERT INTO project_api_keys (project_id, label, key_hash)
                VALUES ($1::uuid, $2, encode(digest($3, 'sha256'), 'hex'))
                RETURNING project_id, key_hash
            )
            UPDATE projects
            SET api_key_hash = inserted.key_hash
            FROM inserted
            WHERE projects.id = inserted.project_id
            "#,
        )
        .bind(project_id)
        .bind(label)
        .bind(raw_key)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            AgentScopeError::Storage(format!(
                "failed to create api key for project {project_id}: {error}"
            ))
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

pub fn generate_session_token() -> String {
    format!(
        "sess_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

fn generate_project_api_key() -> String {
    format!(
        "proj_live_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

fn hash_password(password: &str) -> Result<String, AgentScopeError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| AgentScopeError::Storage(format!("failed to hash password: {error}")))
}

fn verify_argon2_password(hash: &str, password: &str) -> Result<bool, AgentScopeError> {
    if !hash.starts_with("$argon2") {
        return Ok(false);
    }

    let parsed = match PasswordHash::new(hash) {
        Ok(parsed) => parsed,
        Err(_) => return Ok(false),
    };

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database_error) if database_error.code().as_deref() == Some("23505")
    )
}

#[cfg(test)]
mod tests {
    use super::verify_argon2_password;

    #[test]
    fn verify_argon2_password_returns_false_for_legacy_hash_format() {
        let legacy_bcrypt_hash = "$2b$12$6O3R8sj8WvL9x2K5Vf9GpeKgCq8Kuq6UrkM6Q0Yz6i7s0x9D7XWnO";
        let verified = verify_argon2_password(legacy_bcrypt_hash, "password123")
            .expect("legacy hashes should not trigger storage errors");
        assert!(!verified);
    }
}
