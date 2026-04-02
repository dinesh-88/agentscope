use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TrendReport {
    pub id: String,
    pub project_id: String,
    pub window: String,
    pub summary: String,
    pub trends: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrendInsight {
    pub trend_type: String,
    pub severity: String,
    pub message: String,
    pub recommendation: String,
    pub evidence: Value,
    pub impact_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyMetrics {
    pub avg_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub slow_span_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostMetrics {
    pub avg_cost_usd: f64,
    pub total_cost_usd: f64,
    pub spike_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptMetric {
    pub prompt_hash: String,
    pub total_spans: usize,
    pub success_rate: f64,
    pub failure_rate: f64,
}
