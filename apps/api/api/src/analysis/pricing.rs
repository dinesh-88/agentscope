#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    pub input_per_1k_tokens: f64,
    pub output_per_1k_tokens: f64,
}

fn canonicalize_model(model: &str) -> String {
    let lower = model.trim().to_lowercase();
    if lower.is_empty() {
        return lower;
    }

    let without_prefix = lower
        .rsplit_once('/')
        .map(|(_, value)| value)
        .or_else(|| lower.rsplit_once(':').map(|(_, value)| value))
        .unwrap_or(lower.as_str());

    without_prefix.to_string()
}

pub fn get_model_pricing(model: &str) -> Option<ModelPricing> {
    let model = canonicalize_model(model);
    match model.as_str() {
        // GPT-5 family (kept broad so versioned names still match).
        value if value.starts_with("gpt-5-nano") => Some(ModelPricing {
            input_per_1k_tokens: 0.00005,
            output_per_1k_tokens: 0.00020,
        }),
        value if value.starts_with("gpt-5-mini") => Some(ModelPricing {
            input_per_1k_tokens: 0.00015,
            output_per_1k_tokens: 0.00060,
        }),
        value if value.starts_with("gpt-5") => Some(ModelPricing {
            input_per_1k_tokens: 0.0025,
            output_per_1k_tokens: 0.0100,
        }),
        value if value.starts_with("gpt-4o-mini") => Some(ModelPricing {
            input_per_1k_tokens: 0.00015,
            output_per_1k_tokens: 0.00060,
        }),
        value if value.starts_with("gpt-4o") => Some(ModelPricing {
            input_per_1k_tokens: 0.0025,
            output_per_1k_tokens: 0.0100,
        }),
        value if value.starts_with("claude-3-5-haiku") => Some(ModelPricing {
            input_per_1k_tokens: 0.0008,
            output_per_1k_tokens: 0.0040,
        }),
        value if value.starts_with("claude-3-5-sonnet") => Some(ModelPricing {
            input_per_1k_tokens: 0.0030,
            output_per_1k_tokens: 0.0150,
        }),
        value if value.starts_with("claude-3-opus") => Some(ModelPricing {
            input_per_1k_tokens: 0.0150,
            output_per_1k_tokens: 0.0750,
        }),
        _ => None,
    }
}

pub fn estimate_cost(model: &str, input_tokens: i32, output_tokens: i32) -> f64 {
    let Some(pricing) = get_model_pricing(model) else {
        return 0.0;
    };

    ((input_tokens as f64 / 1000.0) * pricing.input_per_1k_tokens)
        + ((output_tokens as f64 / 1000.0) * pricing.output_per_1k_tokens)
}

#[cfg(test)]
mod tests {
    use super::{estimate_cost, get_model_pricing};

    #[test]
    fn pricing_handles_provider_prefixed_models() {
        assert!(get_model_pricing("openai/gpt-4o-mini").is_some());
        assert!(get_model_pricing("anthropic:claude-3-5-sonnet-latest").is_some());
    }

    #[test]
    fn pricing_handles_versioned_model_names() {
        assert!(get_model_pricing("gpt-4o-mini-2024-07-18").is_some());
        assert!(get_model_pricing("gpt-5-mini-2026-01-01").is_some());
        assert!(get_model_pricing("claude-3-5-haiku-20241022").is_some());
    }

    #[test]
    fn estimate_cost_uses_canonicalized_model_name() {
        let cost = estimate_cost("openai/gpt-4o-mini-2024-07-18", 200, 100);
        assert!((cost - 0.00009).abs() < 1e-12);
    }
}
