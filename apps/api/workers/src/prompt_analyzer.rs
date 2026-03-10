use agentscope_common::errors::AgentScopeError;
use agentscope_storage::Storage;
use agentscope_trace::{Artifact, RunInsight, Span};
use chrono::Utc;
use serde_json::Value;
use std::collections::HashSet;
use tracing::info;
use uuid::Uuid;

const PROMPT_TOKEN_THRESHOLD: i64 = 3000;
const MESSAGE_COUNT_THRESHOLD: usize = 10;
const RAG_TOKEN_THRESHOLD: i64 = 2000;
const CONTEXT_UNDERUTILIZED_RATIO: f64 = 0.10;
const DUPLICATE_SENTENCE_SIMILARITY: f64 = 0.65;

pub async fn analyze_completed_runs(storage: &Storage) -> Result<(), AgentScopeError> {
    let runs = storage.list_runs_by_status("completed").await?;

    for run in runs {
        analyze_run(storage, &run.id).await?;
    }

    Ok(())
}

pub async fn analyze_run(storage: &Storage, run_id: &str) -> Result<(), AgentScopeError> {
    let prompt_artifacts = storage.get_artifacts_by_kind(run_id, "llm.prompt").await?;
    let spans = storage.get_spans(run_id).await?;

    let insights = generate_insights(run_id, &prompt_artifacts, &spans);
    storage.replace_run_insights(run_id, &insights).await?;

    info!(%run_id, insight_count = insights.len(), "prompt analysis completed");
    Ok(())
}

fn generate_insights(
    run_id: &str,
    prompt_artifacts: &[Artifact],
    spans: &[Span],
) -> Vec<RunInsight> {
    let mut insights = Vec::new();
    let mut seen_keys = HashSet::new();

    for artifact in prompt_artifacts {
        let span = artifact
            .span_id
            .as_ref()
            .and_then(|span_id| spans.iter().find(|span| span.id == *span_id));

        let prompt_text = collect_prompt_text(&artifact.payload);
        let message_count = extract_messages_len(&artifact.payload);
        let rag_tokens = extract_rag_tokens(&artifact.payload);
        let model = extract_model(&artifact.payload, span);
        let input_tokens = span.and_then(|value| value.input_tokens);

        if let Some(tokens) = input_tokens {
            if tokens > PROMPT_TOKEN_THRESHOLD {
                push_insight(
                    &mut insights,
                    &mut seen_keys,
                    run_id,
                    "prompt_too_large",
                    "high",
                    format!("Prompt size reached {tokens} input tokens, exceeding the 3000-token threshold."),
                    "Trim instructions, remove low-value examples, and summarize long context blocks before sending them to the model.".to_string(),
                );
            }
        }

        if has_duplicate_sentences(&prompt_text) {
            push_insight(
                &mut insights,
                &mut seen_keys,
                run_id,
                "duplicate_prompt_lines",
                "medium",
                "Repeated or near-duplicate instructions were detected in the prompt.".to_string(),
                "Deduplicate repeated guidance and keep one authoritative instruction block to reduce confusion and token waste.".to_string(),
            );
        }

        if let Some(count) = message_count {
            if count > MESSAGE_COUNT_THRESHOLD {
                push_insight(
                    &mut insights,
                    &mut seen_keys,
                    run_id,
                    "conversation_history_large",
                    "medium",
                    format!("Conversation history includes {count} messages, exceeding the 10-message threshold."),
                    "Summarize older turns or retain only the most recent exchanges that materially affect the current answer.".to_string(),
                );
            }
        }

        if let Some(tokens) = rag_tokens {
            if tokens > RAG_TOKEN_THRESHOLD {
                push_insight(
                    &mut insights,
                    &mut seen_keys,
                    run_id,
                    "rag_context_too_large",
                    "high",
                    format!("Retrieved context contributed {tokens} tokens, exceeding the 2000-token threshold."),
                    "Reduce the number of retrieved passages, rerank harder, or summarize retrieved chunks before insertion.".to_string(),
                );
            }
        }

        if let (Some(tokens), Some(model_name)) = (input_tokens, model.as_deref()) {
            if let Some(window) = estimate_context_window(model_name) {
                let utilization = (tokens as f64) / (window as f64);
                if utilization < CONTEXT_UNDERUTILIZED_RATIO {
                    push_insight(
                        &mut insights,
                        &mut seen_keys,
                        run_id,
                        "context_underutilized",
                        "low",
                        format!(
                            "Prompt used about {:.1}% of the estimated {}-token context window for model {}.",
                            utilization * 100.0,
                            window,
                            model_name
                        ),
                        "If quality is limited by missing context, consider adding richer examples, stronger retrieval context, or clearer constraints.".to_string(),
                    );
                }
            }
        }
    }

    insights
}

fn push_insight(
    insights: &mut Vec<RunInsight>,
    seen_keys: &mut HashSet<String>,
    run_id: &str,
    insight_type: &str,
    severity: &str,
    message: String,
    recommendation: String,
) {
    let dedupe_key = format!("{insight_type}:{message}");
    if !seen_keys.insert(dedupe_key) {
        return;
    }

    insights.push(RunInsight {
        id: Uuid::new_v4().to_string(),
        run_id: run_id.to_string(),
        insight_type: insight_type.to_string(),
        severity: severity.to_string(),
        message,
        recommendation,
        created_at: Utc::now(),
    });
}

fn collect_prompt_text(payload: &Value) -> String {
    let mut parts = Vec::new();
    collect_text_recursive(payload, &mut parts);
    parts.join("\n")
}

fn collect_text_recursive(value: &Value, parts: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_recursive(item, parts);
            }
        }
        Value::Object(map) => {
            for key in ["prompt", "input", "content", "text", "messages"] {
                if let Some(value) = map.get(key) {
                    collect_text_recursive(value, parts);
                }
            }
        }
        _ => {}
    }
}

fn extract_messages_len(payload: &Value) -> Option<usize> {
    payload
        .get("messages")
        .and_then(Value::as_array)
        .map(std::vec::Vec::len)
        .or_else(|| {
            payload
                .get("payload")
                .and_then(|value| value.get("messages"))
                .and_then(Value::as_array)
                .map(std::vec::Vec::len)
        })
}

fn extract_rag_tokens(payload: &Value) -> Option<i64> {
    let candidates = [
        payload.get("rag_tokens"),
        payload.get("retrieval_tokens"),
        payload
            .get("payload")
            .and_then(|value| value.get("rag_tokens")),
        payload
            .get("payload")
            .and_then(|value| value.get("retrieval_tokens")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(tokens) = candidate.as_i64() {
            return Some(tokens);
        }
    }

    None
}

fn extract_model(payload: &Value, span: Option<&Span>) -> Option<String> {
    payload
        .get("model")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("payload")
                .and_then(|value| value.get("model"))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .or_else(|| span.and_then(|value| value.model.clone()))
}

fn has_duplicate_sentences(text: &str) -> bool {
    let sentences = split_sentences(text);

    for (index, left) in sentences.iter().enumerate() {
        for right in sentences.iter().skip(index + 1) {
            if sentence_similarity(left, right) >= DUPLICATE_SENTENCE_SIMILARITY {
                return true;
            }
        }
    }

    false
}

fn split_sentences(text: &str) -> Vec<String> {
    text.split(|ch: char| matches!(ch, '.' | '!' | '?' | '\n'))
        .map(normalize_sentence)
        .filter(|sentence| sentence.split_whitespace().count() >= 4)
        .collect()
}

fn normalize_sentence(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch.is_whitespace() {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn sentence_similarity(left: &str, right: &str) -> f64 {
    if left == right {
        return 1.0;
    }

    let left_tokens: HashSet<&str> = left.split_whitespace().collect();
    let right_tokens: HashSet<&str> = right.split_whitespace().collect();

    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }

    let intersection = left_tokens.intersection(&right_tokens).count() as f64;
    let union = left_tokens.union(&right_tokens).count() as f64;

    intersection / union
}

fn estimate_context_window(model: &str) -> Option<i64> {
    let model = model.to_lowercase();

    if model.contains("gpt-4o-mini") || model.contains("gpt-4o") {
        return Some(128_000);
    }
    if model.contains("claude-3-5") {
        return Some(200_000);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{analyze_completed_runs, estimate_context_window, has_duplicate_sentences};
    use agentscope_storage::Storage;
    use chrono::Utc;
    use serde_json::json;
    use sqlx::PgPool;
    use uuid::Uuid;

    #[test]
    fn detects_near_duplicate_sentences() {
        let text = "Always answer with bullet points. Always answer using bullet points.\nProvide a concise summary.";
        assert!(has_duplicate_sentences(text));
    }

    #[test]
    fn resolves_known_context_windows() {
        assert_eq!(estimate_context_window("gpt-4o-mini"), Some(128_000));
        assert_eq!(
            estimate_context_window("claude-3-5-sonnet-latest"),
            Some(200_000)
        );
        assert_eq!(estimate_context_window("unknown-model"), None);
    }

    #[sqlx::test(migrations = "../storage/migrations")]
    async fn analyzes_completed_runs_and_persists_insights(pool: PgPool) {
        let storage = Storage { pool: pool.clone() };
        let project_id = seed_project(&pool).await;
        let run_id = Uuid::new_v4().to_string();
        let span_id = Uuid::new_v4().to_string();

        sqlx::query(
            r#"
            INSERT INTO runs (id, project_id, workflow_name, agent_name, status, started_at, ended_at)
            VALUES ($1::uuid, $2::uuid, 'analysis', 'worker', 'completed', $3, $4)
            "#,
        )
        .bind(&run_id)
        .bind(&project_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            r#"
            INSERT INTO spans
                (id, run_id, parent_span_id, span_type, name, status, started_at, ended_at, provider, model, input_tokens, output_tokens, total_tokens)
            VALUES
                ($1::uuid, $2::uuid, NULL, 'llm_call', 'prompt', 'success', $3, $4, 'openai', 'gpt-4o-mini', 4000, 200, 4200)
            "#,
        )
        .bind(&span_id)
        .bind(&run_id)
        .bind(Utc::now())
        .bind(Utc::now())
        .execute(&pool)
        .await
        .unwrap();

        let messages: Vec<_> = (0..11)
            .map(|index| json!({"role": "user", "content": format!("message {index}")}))
            .collect();

        sqlx::query(
            r#"
            INSERT INTO artifacts (id, run_id, span_id, kind, payload)
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'llm.prompt', $4)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(Uuid::parse_str(&run_id).unwrap())
        .bind(Uuid::parse_str(&span_id).unwrap())
        .bind(json!({
            "model": "gpt-4o-mini",
            "messages": messages,
            "prompt": "Always answer with bullet points. Always answer using bullet points. Summarize the result.",
            "rag_tokens": 2501
        }))
        .execute(&pool)
        .await
        .unwrap();

        analyze_completed_runs(&storage).await.unwrap();

        let insights = storage.get_run_insights(&run_id).await.unwrap();
        let insight_types: std::collections::HashSet<_> = insights
            .iter()
            .map(|insight| insight.insight_type.as_str())
            .collect();

        assert!(insight_types.contains("prompt_too_large"));
        assert!(insight_types.contains("duplicate_prompt_lines"));
        assert!(insight_types.contains("conversation_history_large"));
        assert!(insight_types.contains("rag_context_too_large"));
        assert!(insight_types.contains("context_underutilized"));
    }

    async fn seed_project(pool: &PgPool) -> String {
        let org_id: String = sqlx::query_scalar(
            "INSERT INTO organizations (name) VALUES ('test-org') RETURNING id::text",
        )
        .fetch_one(pool)
        .await
        .unwrap();

        sqlx::query_scalar(
            "INSERT INTO projects (organization_id, name) VALUES ($1::uuid, 'test-project') RETURNING id::text",
        )
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap()
    }
}
