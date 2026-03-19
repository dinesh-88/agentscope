use agentscope_common::errors::AgentScopeError;
use agentscope_trace::{Run, RunExplanation, RunInsight};
use chrono::Utc;
use serde_json::{json, Value};

pub fn explain_run_insights(run: &Run, insights: &[RunInsight]) -> RunExplanation {
    let top = select_top_insights(insights, 3);
    if top.is_empty() {
        return fallback_explanation(run, insights);
    }

    let primary = &top[0];
    let summary = format!(
        "Run `{}` completed with {} prioritized issue(s); top risk is {}.",
        run.id,
        top.len(),
        primary.insight_type
    );

    let why_it_matters = if primary.severity == "high" {
        format!(
            "This is a high-severity issue and can cause repeated failures or degraded user outcomes if left unresolved."
        )
    } else {
        format!(
            "This issue impacts reliability and performance; addressing it should improve run stability and quality."
        )
    };

    let recommended_order = top
        .iter()
        .map(|insight| {
            json!({
                "insight_type": insight.insight_type,
                "severity": insight.severity,
                "action": insight.recommendation,
                "impact_score": insight.impact_score,
            })
        })
        .collect::<Vec<_>>();

    RunExplanation {
        run_id: run.id.clone(),
        summary,
        top_issue: primary.message.clone(),
        why_it_matters,
        next_action: primary.recommendation.clone(),
        recommended_order: Value::Array(recommended_order),
        created_at: Utc::now(),
    }
}

pub fn build_explanation_prompt(run: &Run, insights: &[RunInsight]) -> String {
    let mut prompt = format!(
        "Summarize existing run insights without inventing new findings. run_id={} status={} insights={}\\n",
        run.id,
        run.status,
        insights.len()
    );
    for insight in insights {
        prompt.push_str(&format!(
            "- [{}|impact={:.2}] {} => {}\\n",
            insight.severity, insight.impact_score, insight.message, insight.recommendation
        ));
    }
    prompt
}

pub fn select_top_insights(insights: &[RunInsight], limit: usize) -> Vec<RunInsight> {
    let mut items = insights.to_vec();
    items.sort_by(|a, b| {
        b.impact_score
            .total_cmp(&a.impact_score)
            .then_with(|| a.created_at.cmp(&b.created_at))
    });
    items.into_iter().take(limit).collect()
}

pub fn validate_explanation_output(json: &Value) -> Result<RunExplanation, AgentScopeError> {
    let required = [
        "run_id",
        "summary",
        "top_issue",
        "why_it_matters",
        "next_action",
        "recommended_order",
    ];

    for field in required {
        if json.get(field).is_none() {
            return Err(AgentScopeError::Validation(format!(
                "missing required explanation field: {field}"
            )));
        }
    }

    let run_id = json
        .get("run_id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let summary = json
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let top_issue = json
        .get("top_issue")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let why_it_matters = json
        .get("why_it_matters")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let next_action = json
        .get("next_action")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if run_id.is_empty()
        || summary.is_empty()
        || top_issue.is_empty()
        || why_it_matters.is_empty()
        || next_action.is_empty()
    {
        return Err(AgentScopeError::Validation(
            "invalid explanation output: required string fields must be non-empty".to_string(),
        ));
    }

    Ok(RunExplanation {
        run_id,
        summary,
        top_issue,
        why_it_matters,
        next_action,
        recommended_order: json
            .get("recommended_order")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
        created_at: Utc::now(),
    })
}

pub fn fallback_explanation(run: &Run, insights: &[RunInsight]) -> RunExplanation {
    if insights.is_empty() {
        return RunExplanation {
            run_id: run.id.clone(),
            summary: "No run insights are available yet.".to_string(),
            top_issue: "No major issue detected".to_string(),
            why_it_matters: "The run currently has no flagged issues, so this can be treated as baseline behavior."
                .to_string(),
            next_action: "Keep monitoring future runs for regressions.".to_string(),
            recommended_order: Value::Array(Vec::new()),
            created_at: Utc::now(),
        };
    }

    let top = select_top_insights(insights, 1);
    let issue = top
        .first()
        .map(|item| item.message.clone())
        .unwrap_or_else(|| "No major issue detected".to_string());

    RunExplanation {
        run_id: run.id.clone(),
        summary: format!(
            "{} insights were generated; focus remediation on the highest-impact item first.",
            insights.len()
        ),
        top_issue: issue,
        why_it_matters:
            "Addressing the top issue first typically improves both reliability and performance fastest."
                .to_string(),
        next_action: top
            .first()
            .map(|item| item.recommendation.clone())
            .unwrap_or_else(|| "Review run traces and prioritize follow-up fixes.".to_string()),
        recommended_order: Value::Array(
            insights
                .iter()
                .map(|insight| Value::String(insight.insight_type.clone()))
                .collect(),
        ),
        created_at: Utc::now(),
    }
}
