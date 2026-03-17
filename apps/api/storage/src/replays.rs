use agentscope_common::errors::AgentScopeError;
use agentscope_trace::RunReplay;
use serde_json::Value;

use crate::Storage;

impl Storage {
    pub async fn insert_run_replay(&self, replay: &RunReplay) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            INSERT INTO run_replays (id, original_run_id, current_step, state, created_at)
            VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
            ON CONFLICT (id) DO UPDATE
            SET original_run_id = EXCLUDED.original_run_id,
                current_step = EXCLUDED.current_step,
                state = EXCLUDED.state,
                created_at = EXCLUDED.created_at
            "#,
        )
        .bind(&replay.id)
        .bind(&replay.original_run_id)
        .bind(replay.current_step)
        .bind(&replay.state)
        .bind(replay.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to insert replay {}: {e}", replay.id))
        })?;

        Ok(())
    }

    pub async fn get_run_replay(&self, id: &str) -> Result<Option<RunReplay>, AgentScopeError> {
        let replay = sqlx::query_as::<_, RunReplay>(
            r#"
            SELECT id::text AS id,
                   original_run_id::text AS original_run_id,
                   current_step,
                   state,
                   created_at
            FROM run_replays
            WHERE id = $1::uuid
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to get replay {id}: {e}")))?;

        Ok(replay)
    }

    pub async fn get_run_replay_for_user(
        &self,
        id: &str,
        user_id: &str,
    ) -> Result<Option<RunReplay>, AgentScopeError> {
        let replay = sqlx::query_as::<_, RunReplay>(
            r#"
            SELECT DISTINCT run_replays.id::text AS id,
                   run_replays.original_run_id::text AS original_run_id,
                   run_replays.current_step,
                   run_replays.state,
                   run_replays.created_at
            FROM run_replays
            INNER JOIN runs
                ON runs.id = run_replays.original_run_id
            INNER JOIN projects
                ON projects.id = runs.project_id
            INNER JOIN memberships
                ON memberships.organization_id = projects.organization_id
            WHERE run_replays.id = $1::uuid
              AND memberships.user_id = $2::uuid
            "#,
        )
        .bind(id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            AgentScopeError::Storage(format!("failed to get replay {id} for user {user_id}: {e}"))
        })?;

        Ok(replay)
    }

    pub async fn update_run_replay(
        &self,
        id: &str,
        current_step: i32,
        state: &Value,
    ) -> Result<(), AgentScopeError> {
        sqlx::query(
            r#"
            UPDATE run_replays
            SET current_step = $2,
                state = $3::jsonb
            WHERE id = $1::uuid
            "#,
        )
        .bind(id)
        .bind(current_step)
        .bind(state)
        .execute(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to update replay {id}: {e}")))?;

        Ok(())
    }
}
