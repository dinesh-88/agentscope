import axios from "axios";

export const API_BASE_URL = "http://localhost:8080";
export const UI_JWT_COOKIE_NAME = "agentscope_jwt";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10_000,
});

export type Run = {
  id: string;
  project_id: string;
  workflow_name: string;
  agent_name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
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
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
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
  };
};

function parseCookieValue(source: string, name: string): string | null {
  const match = source.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function getJwtToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return process.env.AGENTSCOPE_UI_JWT ?? null;
  }

  return parseCookieValue(document.cookie, UI_JWT_COOKIE_NAME);
}

export function getClientJwtToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return parseCookieValue(document.cookie, UI_JWT_COOKIE_NAME);
}

export function storeUiJwt(token: string) {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${UI_JWT_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
}

export function clearUiJwt() {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${UI_JWT_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getJwtToken();
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function request<T>(path: string): Promise<T> {
  const response = await api.get<T>(path, {
    headers: await authHeaders(),
  });
  return response.data;
}

async function postRequest<T>(path: string): Promise<T> {
  const response = await api.post<T>(path, undefined, {
    headers: await authHeaders(),
  });
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
