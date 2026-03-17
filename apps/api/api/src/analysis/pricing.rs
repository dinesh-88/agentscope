#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    pub input_per_1k_tokens: f64,
    pub output_per_1k_tokens: f64,
}

pub fn get_model_pricing(model: &str) -> Option<ModelPricing> {
    match model {
        "gpt-4o" => Some(ModelPricing {
            input_per_1k_tokens: 0.0025,
            output_per_1k_tokens: 0.0100,
        }),
        "gpt-4o-mini" => Some(ModelPricing {
            input_per_1k_tokens: 0.00015,
            output_per_1k_tokens: 0.00060,
        }),
        "claude-3-5-sonnet" | "claude-3-5-sonnet-latest" => Some(ModelPricing {
            input_per_1k_tokens: 0.0030,
            output_per_1k_tokens: 0.0150,
        }),
        "claude-3-opus" => Some(ModelPricing {
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
