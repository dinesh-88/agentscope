use uuid::Uuid;

pub const API_KEY_HEADER: &str = "x-agentscope-api-key";

pub fn generate_project_api_key() -> String {
    format!(
        "proj_live_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}
