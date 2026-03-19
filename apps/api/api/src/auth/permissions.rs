#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    RunRead,
    RunCompare,
    InsightRead,
    ProjectManage,
    UserManage,
    ApiKeyCreate,
}

impl Permission {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RunRead => "run:read",
            Self::RunCompare => "run:compare",
            Self::InsightRead => "insight:read",
            Self::ProjectManage => "project:manage",
            Self::UserManage => "user:manage",
            Self::ApiKeyCreate => "api_key:create",
        }
    }
}

pub fn role_permissions(role: &str) -> &'static [Permission] {
    match role {
        "owner" => &[
            Permission::RunRead,
            Permission::RunCompare,
            Permission::InsightRead,
            Permission::ProjectManage,
            Permission::UserManage,
            Permission::ApiKeyCreate,
        ],
        "admin" => &[
            Permission::RunRead,
            Permission::RunCompare,
            Permission::InsightRead,
            Permission::ProjectManage,
            Permission::UserManage,
            Permission::ApiKeyCreate,
        ],
        "developer" => &[
            Permission::RunRead,
            Permission::RunCompare,
            Permission::InsightRead,
            Permission::ApiKeyCreate,
        ],
        "viewer" => &[Permission::RunRead, Permission::InsightRead],
        _ => &[],
    }
}
