import axios from "axios";
import { cookies } from "next/headers";

import {
  API_BASE_URL,
  UI_SESSION_COOKIE_NAME,
  type Artifact,
  type DemoScenario,
  type MeResponse,
  type Run,
  type RunAnalysis,
  type RunComparison,
  type RunInsight,
  type RunMetrics,
  type RunRootCause,
  type Span,
} from "@/lib/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10_000,
});

async function authHeaders(): Promise<Record<string, string>> {
  const token = (await cookies()).get(UI_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return {};
  }

  return {
    Cookie: `${UI_SESSION_COOKIE_NAME}=${token}`,
  };
}

async function request<T>(path: string): Promise<T> {
  const response = await api.get<T>(path, {
    headers: await authHeaders(),
  });
  return response.data;
}

function isNotFound(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function isServerError(error: unknown) {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return typeof status === "number" && status >= 500;
}

function logOptionalEndpointFailure(path: string, error: unknown) {
  if (!axios.isAxiosError(error)) {
    return;
  }

  console.warn(`Optional API request failed for ${path} with status ${error.response?.status ?? "unknown"}`);
}

async function requestOptional<T>(path: string, fallback: T): Promise<T> {
  try {
    return await request<T>(path);
  } catch (error) {
    if (isNotFound(error) || isServerError(error)) {
      logOptionalEndpointFailure(path, error);
      return fallback;
    }

    throw error;
  }
}

export async function getRuns(): Promise<Run[]> {
  return request<Run[]>("/v1/runs");
}

export type RunSearchFilters = {
  query?: string;
  status?: string;
  workflow_name?: string;
  agent_name?: string;
  project_id?: string;
  limit?: number;
};

export async function getRunsFiltered(filters: RunSearchFilters = {}): Promise<Run[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<Run[]>(`/v1/runs${suffix}`);
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
  return requestOptional<Span[]>(`/v1/runs/${runId}/spans`, []);
}

export async function getRunArtifacts(runId: string): Promise<Artifact[]> {
  return requestOptional<Artifact[]>(`/v1/runs/${runId}/artifacts`, []);
}

export async function getRunInsights(runId: string): Promise<RunInsight[]> {
  return requestOptional<RunInsight[]>(`/v1/runs/${runId}/insights`, []);
}

export async function getRunRootCause(runId: string): Promise<RunRootCause | null> {
  return requestOptional<RunRootCause | null>(`/v1/runs/${runId}/root-cause`, null);
}

export async function getRunMetrics(runId: string): Promise<RunMetrics | null> {
  return requestOptional<RunMetrics | null>(`/v1/runs/${runId}/metrics`, null);
}

export async function getRunAnalysis(runId: string): Promise<RunAnalysis | null> {
  return requestOptional<RunAnalysis | null>(`/v1/runs/${runId}/analysis`, null);
}

export async function compareRuns(runA: string, runB: string): Promise<RunComparison | null> {
  try {
    return await request<RunComparison>(`/v1/runs/${runA}/compare/${runB}`);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function getCurrentUser(): Promise<MeResponse | null> {
  try {
    return await request<MeResponse>("/v1/auth/me");
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function getDemoScenarios(): Promise<DemoScenario[]> {
  return request<DemoScenario[]>("/v1/demo/scenarios");
}
