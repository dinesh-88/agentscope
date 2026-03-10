import axios from "axios";

export const API_BASE_URL = "http://localhost:8080";

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

async function request<T>(path: string): Promise<T> {
  const response = await api.get<T>(path);
  return response.data;
}

export async function getRuns(): Promise<Run[]> {
  return request<Run[]>("/v1/runs");
}

export async function getRun(runId: string): Promise<Run> {
  return request<Run>(`/v1/runs/${runId}`);
}

export async function getRunSpans(runId: string): Promise<Span[]> {
  return request<Span[]>(`/v1/runs/${runId}/spans`);
}

export async function getRunArtifacts(runId: string): Promise<Artifact[]> {
  return request<Artifact[]>(`/v1/runs/${runId}/artifacts`);
}

export async function getRunInsights(runId: string): Promise<RunInsight[]> {
  return request<RunInsight[]>(`/v1/runs/${runId}/insights`);
}

export async function getRunRootCause(runId: string): Promise<RunRootCause | null> {
  try {
    return await request<RunRootCause>(`/v1/runs/${runId}/root-cause`);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function getRunMetrics(runId: string): Promise<RunMetrics | null> {
  try {
    return await request<RunMetrics>(`/v1/runs/${runId}/metrics`);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}
