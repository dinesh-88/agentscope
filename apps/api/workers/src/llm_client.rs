use std::time::Duration;

use agentscope_common::errors::AgentScopeError;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::scoring::RankedIssue;

#[derive(Debug, Clone)]
pub struct LlmClient {
    http: Client,
    api_key: String,
    base_url: String,
    model: String,
    max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueInsightPayload {
    pub summary: String,
    pub root_cause: String,
    pub recommended_fix: String,
    pub expected_impact: String,
    pub confidence_score: f64,
}

#[derive(Debug, Serialize)]
struct ChatCompletionsRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f64,
    response_format: ResponseFormat,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionsResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: AssistantMessage,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    content: String,
}

impl LlmClient {
    pub fn from_env() -> Result<Self, AgentScopeError> {
        let api_key = std::env::var("ISSUE_LLM_API_KEY")
            .or_else(|_| std::env::var("OPENAI_API_KEY"))
            .map_err(|_| {
                AgentScopeError::Config(
                    "ISSUE_LLM_API_KEY (or OPENAI_API_KEY) is required for issue pipeline"
                        .to_string(),
                )
            })?;

        let base_url = std::env::var("ISSUE_LLM_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model = std::env::var("ISSUE_LLM_MODEL").unwrap_or_else(|_| "gpt-4o-mini".to_string());
        let max_retries = std::env::var("ISSUE_LLM_MAX_RETRIES")
            .ok()
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(3);

        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| {
                AgentScopeError::Config(format!("failed to build LLM HTTP client: {e}"))
            })?;

        Ok(Self {
            http,
            api_key,
            base_url,
            model,
            max_retries,
        })
    }

    fn build_prompt(issue: &RankedIssue, total_runs: i64) -> String {
        let frequency_pct = if total_runs > 0 {
            (issue.affected_run_count as f64 / total_runs as f64) * 100.0
        } else {
            0.0
        };

        format!(
            "You are an expert AI systems engineer.\n\n\
             Issue: {issue_key}\n\
             Category: {category}\n\
             Subcategory: {subcategory}\n\
             Frequency: {frequency_pct:.2}% of runs\n\
             Cost impact: ${cost:.4}\n\
             Severity: {severity}\n\n\
             Explain:\n\
             1. Why this issue occurs\n\
             2. Root cause\n\
             3. Recommended fix\n\
             4. Expected impact\n\n\
             Return JSON:\n\
             {{\n\
               \"summary\": \"...\",\n\
               \"root_cause\": \"...\",\n\
               \"recommended_fix\": \"...\",\n\
               \"expected_impact\": \"...\",\n\
               \"confidence_score\": 0.0\n\
             }}",
            issue_key = issue.issue_key,
            category = issue.category,
            subcategory = issue.subcategory,
            frequency_pct = frequency_pct,
            cost = issue.failed_run_cost_usd,
            severity = issue.severity
        )
    }

    pub async fn enrich_issue(
        &self,
        issue: &RankedIssue,
        total_runs: i64,
    ) -> Result<Option<IssueInsightPayload>, AgentScopeError> {
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let prompt = Self::build_prompt(issue, total_runs);

        let req = ChatCompletionsRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: "Return only valid JSON.".to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: prompt,
                },
            ],
            temperature: 0.1,
            response_format: ResponseFormat {
                format_type: "json_object".to_string(),
            },
        };

        let mut attempt = 0;
        while attempt < self.max_retries {
            attempt += 1;

            let response = self
                .http
                .post(&url)
                .bearer_auth(&self.api_key)
                .json(&req)
                .send()
                .await;

            let response = match response {
                Ok(res) => res,
                Err(err) => {
                    if attempt >= self.max_retries {
                        return Err(AgentScopeError::Storage(format!(
                            "LLM request failed after {attempt} attempts: {err}"
                        )));
                    }
                    tokio::time::sleep(Duration::from_millis(250 * attempt as u64)).await;
                    continue;
                }
            };

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                if attempt >= self.max_retries {
                    return Err(AgentScopeError::Storage(format!(
                        "LLM response failed with status {status}: {body}"
                    )));
                }
                tokio::time::sleep(Duration::from_millis(250 * attempt as u64)).await;
                continue;
            }

            let payload = response
                .json::<ChatCompletionsResponse>()
                .await
                .map_err(|e| AgentScopeError::Storage(format!("invalid LLM response JSON: {e}")))?;

            let content = payload
                .choices
                .first()
                .map(|c| c.message.content.clone())
                .unwrap_or_default();

            if content.trim().is_empty() {
                return Ok(None);
            }

            let raw_json: Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            };

            let mut parsed: IssueInsightPayload = match serde_json::from_value(raw_json) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            };

            if parsed.summary.trim().is_empty()
                || parsed.root_cause.trim().is_empty()
                || parsed.recommended_fix.trim().is_empty()
                || parsed.expected_impact.trim().is_empty()
            {
                return Ok(None);
            }

            parsed.confidence_score = parsed.confidence_score.clamp(0.0, 1.0);
            return Ok(Some(parsed));
        }

        Ok(None)
    }
}
