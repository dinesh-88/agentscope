use agentscope_common::errors::AgentScopeError;
use agentscope_trace::{ArtifactSearchResponse, ArtifactSearchResult};

use crate::Storage;

#[derive(Debug, Clone, Default)]
pub struct ArtifactSearchFilters {
    pub query: String,
    pub error_type: Option<String>,
    pub model: Option<String>,
    pub span_type: Option<String>,
    pub tags: Option<Vec<String>>,
    pub limit: i64,
    pub offset: i64,
}

impl Storage {
    pub async fn search_artifacts_for_user(
        &self,
        user_id: &str,
        filters: &ArtifactSearchFilters,
    ) -> Result<ArtifactSearchResponse, AgentScopeError> {
        let results = sqlx::query_as::<_, ArtifactSearchResult>(
            r#"
            SELECT
                r.id::text AS run_id,
                s.id::text AS span_id,
                a.id::text AS artifact_id,
                s.span_type,
                s.error_type,
                s.model,
                ts_headline(
                    'english',
                    a.payload::text,
                    plainto_tsquery('english', $1),
                    'MaxFragments=2,MaxWords=15,MinWords=5'
                ) AS snippet,
                ts_rank(a.tsv, plainto_tsquery('english', $1))::double precision AS rank
            FROM artifacts a
            JOIN spans s
                ON s.id = a.span_id
            JOIN runs r
                ON r.id = s.run_id
            JOIN projects p
                ON p.id = r.project_id
            JOIN memberships m
                ON m.organization_id = p.organization_id
            WHERE m.user_id = $2::uuid
              AND a.tsv @@ plainto_tsquery('english', $1)
              AND ($3::text IS NULL OR s.error_type = $3)
              AND ($4::text IS NULL OR s.model = $4)
              AND ($5::text IS NULL OR s.span_type = $5)
              AND ($6::text[] IS NULL OR r.tags && $6)
            ORDER BY rank DESC, a.id
            LIMIT $7 OFFSET $8
            "#,
        )
        .bind(&filters.query)
        .bind(user_id)
        .bind(filters.error_type.as_deref())
        .bind(filters.model.as_deref())
        .bind(filters.span_type.as_deref())
        .bind(filters.tags.as_ref())
        .bind(filters.limit)
        .bind(filters.offset)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to search artifacts: {e}")))?;

        let total = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*)
            FROM artifacts a
            JOIN spans s
                ON s.id = a.span_id
            JOIN runs r
                ON r.id = s.run_id
            JOIN projects p
                ON p.id = r.project_id
            JOIN memberships m
                ON m.organization_id = p.organization_id
            WHERE m.user_id = $1::uuid
              AND a.tsv @@ plainto_tsquery('english', $2)
              AND ($3::text IS NULL OR s.error_type = $3)
              AND ($4::text IS NULL OR s.model = $4)
              AND ($5::text IS NULL OR s.span_type = $5)
              AND ($6::text[] IS NULL OR r.tags && $6)
            "#,
        )
        .bind(user_id)
        .bind(&filters.query)
        .bind(filters.error_type.as_deref())
        .bind(filters.model.as_deref())
        .bind(filters.span_type.as_deref())
        .bind(filters.tags.as_ref())
        .fetch_one(&self.pool)
        .await
        .map_err(|e| AgentScopeError::Storage(format!("failed to count search results: {e}")))?;

        Ok(ArtifactSearchResponse { results, total })
    }
}
