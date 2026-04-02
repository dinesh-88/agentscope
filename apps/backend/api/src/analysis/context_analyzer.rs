use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CONTEXT_BLOAT_THRESHOLD_CHARS: usize = 50_000;
const DOMINANT_SOURCE_RATIO_THRESHOLD: f64 = 0.60;
const REDUNDANCY_SIMILARITY_THRESHOLD: f64 = 0.80;
const LARGE_PROMPT_THRESHOLD_CHARS: usize = 50_000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContextSource {
    pub name: String,
    #[serde(rename = "type")]
    pub source_type: String,
    pub content: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContextInsight {
    pub insight_type: String,
    pub severity: String,
    pub message: String,
    pub recommendation: String,
    pub evidence: Value,
}

pub fn analyze_context(
    context_sources: &[ContextSource],
    final_prompt: &str,
) -> Vec<ContextInsight> {
    if context_sources.is_empty() {
        return vec![ContextInsight {
            insight_type: "MISSING_CONTEXT".to_string(),
            severity: "low".to_string(),
            message: "No context provided to LLM call".to_string(),
            recommendation: "Consider adding structured context for better control".to_string(),
            evidence: json!({
                "source_count": 0,
                "total_context_chars": 0,
                "final_prompt_chars": final_prompt.len()
            }),
        }];
    }

    let mut insights = Vec::new();
    let total_context_chars = context_sources
        .iter()
        .map(|source| source.content.chars().count())
        .sum::<usize>();
    let largest_source = context_sources
        .iter()
        .max_by_key(|source| source.content.chars().count());

    if total_context_chars > CONTEXT_BLOAT_THRESHOLD_CHARS {
        insights.push(ContextInsight {
            insight_type: "CONTEXT_BLOAT".to_string(),
            severity: "high".to_string(),
            message: "Context size is large and may impact performance".to_string(),
            recommendation: "Reduce or summarize large context sources".to_string(),
            evidence: json!({
                "total_context_chars": total_context_chars,
                "threshold_chars": CONTEXT_BLOAT_THRESHOLD_CHARS
            }),
        });
    }

    if let Some(largest) = largest_source {
        let largest_chars = largest.content.chars().count();
        let dominant_ratio = largest_chars as f64 / total_context_chars as f64;
        if dominant_ratio > DOMINANT_SOURCE_RATIO_THRESHOLD {
            insights.push(ContextInsight {
                insight_type: "DOMINANT_CONTEXT_SOURCE".to_string(),
                severity: "medium".to_string(),
                message: format!("{} dominates context size", largest.name),
                recommendation: "Consider reducing or splitting this context".to_string(),
                evidence: json!({
                    "source_name": largest.name,
                    "largest_source_chars": largest_chars,
                    "total_context_chars": total_context_chars,
                    "dominant_ratio": dominant_ratio
                }),
            });
        }
    }

    if let Some((left, right, similarity)) = find_redundant_pair(context_sources) {
        insights.push(ContextInsight {
            insight_type: "CONTEXT_REDUNDANCY".to_string(),
            severity: "medium".to_string(),
            message: "Multiple context sources contain overlapping content".to_string(),
            recommendation: "Remove duplicate instructions to reduce prompt size".to_string(),
            evidence: json!({
                "source_a": left.name,
                "source_b": right.name,
                "similarity": similarity
            }),
        });
    }

    let final_prompt_chars = final_prompt.chars().count();
    if final_prompt_chars > LARGE_PROMPT_THRESHOLD_CHARS {
        insights.push(ContextInsight {
            insight_type: "PROMPT_WITH_CONTEXT_TOO_LARGE".to_string(),
            severity: "high".to_string(),
            message: "Final prompt is large and includes multiple context sources".to_string(),
            recommendation: "Trim context or summarize before sending to model".to_string(),
            evidence: json!({
                "final_prompt_chars": final_prompt_chars,
                "threshold_chars": LARGE_PROMPT_THRESHOLD_CHARS,
                "source_count": context_sources.len()
            }),
        });
    }

    insights
}

pub fn parse_context_sources(value: Option<&Value>) -> Vec<ContextSource> {
    let Some(Value::Array(entries)) = value else {
        return Vec::new();
    };

    entries
        .iter()
        .filter_map(|entry| {
            let object = entry.as_object()?;
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let source_type = object
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("runtime")
                .to_string();
            let content = match object.get("content") {
                Some(Value::String(raw)) => raw.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            let hash = object
                .get("hash")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            Some(ContextSource {
                name,
                source_type,
                content,
                hash,
            })
        })
        .collect()
}

pub fn extract_context_data(payload: &Value) -> &Value {
    payload.get("data").unwrap_or(payload)
}

pub fn final_prompt_to_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(raw)) => raw.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn find_redundant_pair(
    context_sources: &[ContextSource],
) -> Option<(&ContextSource, &ContextSource, f64)> {
    let mut best: Option<(&ContextSource, &ContextSource, f64)> = None;
    for left_index in 0..context_sources.len() {
        for right_index in (left_index + 1)..context_sources.len() {
            let left = &context_sources[left_index];
            let right = &context_sources[right_index];
            let similarity = jaccard_similarity(&left.content, &right.content);
            if similarity <= REDUNDANCY_SIMILARITY_THRESHOLD {
                continue;
            }

            match best {
                Some((_, _, current_similarity)) if current_similarity >= similarity => {}
                _ => best = Some((left, right, similarity)),
            }
        }
    }
    best
}

fn jaccard_similarity(left: &str, right: &str) -> f64 {
    if left == right {
        return 1.0;
    }

    let left_tokens = tokenize(left);
    let right_tokens = tokenize(right);
    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }

    let intersection = left_tokens.intersection(&right_tokens).count();
    let union = left_tokens.union(&right_tokens).count();
    if union == 0 {
        return 0.0;
    }
    intersection as f64 / union as f64
}

fn tokenize(content: &str) -> HashSet<String> {
    content
        .split_whitespace()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(|token| token.to_lowercase())
        .collect::<HashSet<_>>()
}

#[cfg(test)]
mod tests {
    use super::{analyze_context, ContextSource};

    #[test]
    fn returns_missing_context_when_empty() {
        let insights = analyze_context(&[], "hello");
        assert_eq!(insights.len(), 1);
        assert_eq!(insights[0].insight_type, "MISSING_CONTEXT");
    }

    #[test]
    fn detects_redundant_sources() {
        let sources = vec![
            ContextSource {
                name: "A".to_string(),
                source_type: "file".to_string(),
                content: "alpha beta gamma delta epsilon alpha beta gamma delta epsilon"
                    .to_string(),
                hash: "1".to_string(),
            },
            ContextSource {
                name: "B".to_string(),
                source_type: "file".to_string(),
                content: "alpha beta gamma delta epsilon alpha beta gamma delta epsilon"
                    .to_string(),
                hash: "2".to_string(),
            },
        ];
        let insights = analyze_context(&sources, "ok");
        assert!(insights
            .iter()
            .any(|insight| insight.insight_type == "CONTEXT_REDUNDANCY"));
    }

    #[test]
    fn detects_dominant_source() {
        let sources = vec![
            ContextSource {
                name: "AGENTS.md".to_string(),
                source_type: "file".to_string(),
                content: "dominant ".repeat(500),
                hash: "1".to_string(),
            },
            ContextSource {
                name: "runtime".to_string(),
                source_type: "runtime".to_string(),
                content: "small".to_string(),
                hash: "2".to_string(),
            },
        ];
        let insights = analyze_context(&sources, "ok");
        assert!(insights
            .iter()
            .any(|insight| insight.insight_type == "DOMINANT_CONTEXT_SOURCE"));
    }

    #[test]
    fn detects_large_prompt_with_context() {
        let sources = vec![ContextSource {
            name: "A".to_string(),
            source_type: "file".to_string(),
            content: "tiny".to_string(),
            hash: "1".to_string(),
        }];
        let large_prompt = "x".repeat(50_100);
        let insights = analyze_context(&sources, &large_prompt);
        assert!(insights
            .iter()
            .any(|insight| insight.insight_type == "PROMPT_WITH_CONTEXT_TOO_LARGE"));
    }
}
