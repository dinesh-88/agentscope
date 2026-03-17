import axios from "axios";

export const API_BASE_URL = "http://localhost:8080";
export const UI_SESSION_COOKIE_NAME = "agentscope_session";

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
  project_name?: string;
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

async function request<T>(path: string): Promise<T> {
  const response = await api.get<T>(path);
  return response.data;
}

async function postRequest<T>(path: string): Promise<T> {
  const response = await api.post<T>(path);
  return response.data;
}

function isNotFound(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
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
  await api.post("/v1/auth/logout");
}

export async function getCurrentUser(): Promise<MeResponse> {
  const response = await api.get<MeResponse>("/v1/auth/me");
  return response.data;
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
