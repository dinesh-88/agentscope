import axios from "axios";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:8080";
export const UI_SESSION_COOKIE_NAME = process.env.NEXT_PUBLIC_UI_SESSION_COOKIE_NAME ?? "agentscope_session";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10_000,
  withCredentials: true,
});

export type Run = {
  id: string;
  project_id: string;
  organization_id?: string | null;
  workflow_name: string;
  agent_name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  total_cost_usd?: number;
};

export type Span = {
  id: string;
  run_id: string;
  parent_span_id: string | null;
  span_type: string;
  name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  provider?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  estimated_cost?: number | null;
  context_window?: number | null;
  context_usage_percent?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type Artifact = {
  id: string;
  run_id: string;
  span_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
};

export type RunInsight = {
  id: string;
  run_id: string;
  insight_type: string;
  severity: string;
  message: string;
  recommendation: string;
  created_at: string;
};

export type ProjectInsight = {
  id: string;
  category: string;
  type: string;
  title: string;
  description: string;
  impact: "low" | "medium" | "high";
  suggestion: string;
  confidence: number;
  highlighted: boolean;
  created_at: string;
};

export type RunRootCause = {
  id: string;
  run_id: string;
  root_cause_type: string;
  confidence: number;
  message: string;
  evidence: Record<string, unknown>;
  suggested_fix: string;
  created_at: string;
};

export type RunMetrics = {
  run_id: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
};

export type RunAnalysis = {
  id: string;
  run_id: string;
  project_id: string;
  failure_types: string[];
  root_cause_category: string;
  summary: string;
  evidence: Record<string, unknown>;
  suggested_fixes: unknown[];
  created_at: string;
  updated_at: string;
};

export type ArtifactDiff = {
  label: string;
  run_a: string[];
  run_b: string[];
};

export type RunComparison = {
  run_a: Run;
  run_b: Run;
  summary: {
    status_changed: boolean;
    token_delta: number;
    cost_delta: number;
    span_count_delta: number;
  };
  diffs: {
    prompts: ArtifactDiff[];
    responses: ArtifactDiff[];
    models: string[];
    artifacts: ArtifactDiff[];
    metrics: {
      run_a: RunMetrics;
      run_b: RunMetrics;
      token_delta: number;
      cost_delta: number;
    };
    spans: string[];
  };
};

export type SandboxTarget = "python" | "real" | "ts";

export type SandboxStartResponse = {
  status: string;
  target: SandboxTarget;
};

export type SandboxTargetStatus = {
  target: SandboxTarget;
  status: string;
  pid: number | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_exit_code: number | null;
  last_error: string | null;
};

export type SandboxStatusResponse = {
  python: SandboxTargetStatus;
  real: SandboxTargetStatus;
  ts: SandboxTargetStatus;
};

export type LoginResponse = {
  token: string;
  expires_at: string;
  user: {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url?: string | null;
  };
  onboarding: OnboardingState;
};

export type RegisterRequest = {
  email: string;
  password: string;
  display_name?: string;
  organization_name: string;
  project_name: string;
};

export type RegisterResponse = LoginResponse & {
  organization: {
    id: string;
    name: string;
  };
  project: {
    id: string;
    name: string;
  };
  api_key: string;
};

export type Membership = {
  id: string;
  organization_id: string;
  organization_name: string;
  role: string;
  created_at: string;
};

export type OnboardingState = {
  has_organization: boolean;
  has_project: boolean;
  has_first_run: boolean;
  default_project_id: string | null;
  generated_api_key: string | null;
};

export type MeResponse = {
  user: {
    id: string;
    email: string;
    display_name: string | null;
    avatar_url: string | null;
    memberships: Membership[];
    permissions: string[];
    is_admin: boolean;
  };
  onboarding: OnboardingState;
};

export type DemoScenario = {
  id: string;
  name: string;
};

export type DemoRunResponse = {
  status: string;
  run_id: string;
};

export type ProjectApiKeyResponse = {
  api_key: string;
};

export type ProjectUsagePoint = {
  date: string;
  runs: number;
  tokens: number;
  cost: number;
  errors: number;
};

export type Alert = {
  id: string;
  project_id: string;
  name: string;
  condition_type: string;
  threshold_value: number;
  window_minutes: number;
  enabled: boolean;
  created_at: string;
};

export type AlertEvent = {
  id: string;
  alert_id: string;
  triggered_at: string;
  payload: Record<string, unknown>;
};

export type CreateAlertRequest = {
  project_id: string;
  name: string;
  condition_type: string;
  threshold_value: number;
  window_minutes: number;
};

export type TeamMember = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  joined_at: string;
};

export type InviteRecord = {
  id: string;
  email: string;
  organization_id: string;
  role: string;
  token: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};

async function request<T>(path: string): Promise<T> {
  const response = await api.get<T>(path);
  return response.data;
}

async function postRequest<T>(path: string): Promise<T> {
  const response = await api.post<T>(path);
  return response.data;
}

async function postRequestWithBody<T>(path: string, payload: unknown): Promise<T> {
  const response = await api.post<T>(path, payload);
  return response.data;
}

async function deleteRequest(path: string): Promise<void> {
  await api.delete(path);
}

function isNotFound(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function isUnauthorized(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

export async function getRuns(): Promise<Run[]> {
  return request<Run[]>("/v1/runs");
}

export async function getRun(runId: string): Promise<Run | null> {
  try {
    return await request<Run>(`/v1/runs/${runId}`);
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }

    const runs = await getRuns();
    return runs.find((run) => run.id === runId) ?? null;
  }
}

export async function getRunSpans(runId: string): Promise<Span[]> {
  try {
    return await request<Span[]>(`/v1/runs/${runId}/spans`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getRunArtifacts(runId: string): Promise<Artifact[]> {
  try {
    return await request<Artifact[]>(`/v1/runs/${runId}/artifacts`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getRunInsights(runId: string): Promise<RunInsight[]> {
  try {
    return await request<RunInsight[]>(`/v1/runs/${runId}/insights`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getProjectInsights(projectId: string): Promise<ProjectInsight[]> {
  try {
    return await request<ProjectInsight[]>(`/v1/projects/${projectId}/insights`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getRunRootCause(runId: string): Promise<RunRootCause | null> {
  try {
    return await request<RunRootCause>(`/v1/runs/${runId}/root-cause`);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function getRunMetrics(runId: string): Promise<RunMetrics | null> {
  try {
    return await request<RunMetrics>(`/v1/runs/${runId}/metrics`);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function getRunAnalysis(runId: string): Promise<RunAnalysis | null> {
  try {
    return await request<RunAnalysis>(`/v1/runs/${runId}/analysis`);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function compareRuns(runA: string, runB: string): Promise<RunComparison> {
  return request<RunComparison>(`/v1/runs/${runA}/compare/${runB}`);
}

export async function runSandbox(target: SandboxTarget): Promise<SandboxStartResponse> {
  return postRequest<SandboxStartResponse>(`/v1/sandbox/${target}/run`);
}

export async function getSandboxStatus(): Promise<SandboxStatusResponse> {
  return request<SandboxStatusResponse>("/v1/sandbox/status");
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>("/v1/auth/login", {
    email,
    password,
  });
  return response.data;
}

export async function register(payload: RegisterRequest): Promise<RegisterResponse> {
  const response = await api.post<RegisterResponse>("/v1/auth/register", payload);
  return response.data;
}

export async function logout(): Promise<void> {
  try {
    await api.post("/v1/auth/logout");
  } finally {
    if (typeof document !== "undefined") {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${UI_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }
  }
}

export async function getCurrentUser(): Promise<MeResponse> {
  try {
    const response = await api.get<MeResponse>("/v1/auth/me");
    return response.data;
  } catch (error) {
    if (isUnauthorized(error) || isNotFound(error)) {
      return {
        user: {
          id: "",
          email: "",
          display_name: null,
          avatar_url: null,
          memberships: [],
          permissions: [],
          is_admin: false,
        },
        onboarding: {
          has_organization: false,
          has_project: false,
          has_first_run: false,
          default_project_id: null,
          generated_api_key: null,
        },
      };
    }
    throw error;
  }
}

export async function getOnboardingState(): Promise<OnboardingState> {
  return request<OnboardingState>("/v1/onboarding/state");
}

export async function getDemoScenarios(): Promise<DemoScenario[]> {
  return request<DemoScenario[]>("/v1/demo/scenarios");
}

export async function runDemoScenario(scenario: string): Promise<DemoRunResponse> {
  const response = await api.post<DemoRunResponse>("/v1/demo/run", {
    scenario,
  });
  return response.data;
}

export async function getProjectUsage(projectId: string): Promise<ProjectUsagePoint[]> {
  try {
    return await request<ProjectUsagePoint[]>(`/v1/projects/${projectId}/usage`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getAlerts(): Promise<Alert[]> {
  try {
    return await request<Alert[]>("/v1/alerts");
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function createAlert(payload: CreateAlertRequest): Promise<Alert> {
  return postRequestWithBody<Alert>("/v1/alerts", payload);
}

export async function deleteAlert(alertId: string): Promise<void> {
  return deleteRequest(`/v1/alerts/${alertId}`);
}

export async function getAlertEvents(): Promise<AlertEvent[]> {
  try {
    return await request<AlertEvent[]>("/v1/alerts/events");
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function createOrgInvite(
  organizationId: string,
  payload: { email: string; role: string },
): Promise<InviteRecord> {
  return postRequestWithBody<InviteRecord>(`/v1/orgs/${organizationId}/invites`, payload);
}

export async function acceptInvite(token: string): Promise<void> {
  await postRequestWithBody<void>("/v1/invites/accept", { token });
}

export async function getOrgMembers(organizationId: string): Promise<TeamMember[]> {
  try {
    return await request<TeamMember[]>(`/v1/orgs/${organizationId}/members`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function removeOrgMember(organizationId: string, userId: string): Promise<void> {
  return deleteRequest(`/v1/orgs/${organizationId}/members/${userId}`);
}

export async function createProjectApiKey(projectId: string): Promise<ProjectApiKeyResponse> {
  return postRequest<ProjectApiKeyResponse>(`/v1/projects/${projectId}/api-keys`);
}
