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
  user_id?: string | null;
  session_id?: string | null;
  environment?: string | null;
  workflow_name: string;
  agent_name: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_tokens?: number;
  total_cost_usd?: number;
  success?: boolean | null;
  error_count?: number | null;
  avg_latency_ms?: number | null;
  p95_latency_ms?: number | null;
  success_rate?: number | null;
  tags?: string[] | null;
  experiment_id?: string | null;
  variant?: string | null;
  metadata?: Record<string, unknown> | null;
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
  context?: Record<string, unknown> | null;
  context_tokens?: number | null;
  instruction_context?: Record<string, unknown> | null;
  context_window?: number | null;
  context_usage_percent?: number | null;
  latency_ms?: number | null;
  success?: boolean | null;
  error_type?: string | null;
  error_source?: string | null;
  retryable?: boolean | null;
  prompt_hash?: string | null;
  prompt_template_id?: string | null;
  prompt_version_id?: string | null;
  prompt_version?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  max_tokens?: number | null;
  retry_attempt?: number | null;
  max_attempts?: number | null;
  tool_name?: string | null;
  tool_version?: string | null;
  tool_latency_ms?: number | null;
  tool_success?: boolean | null;
  evaluation?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  step_transition?: {
    from_span_id: string;
    to_span_id: string;
    added_messages: string[];
    removed_messages: string[];
    messages_added: number;
    messages_removed: number;
    token_delta: number;
    tool_output_added: boolean;
    tool_outputs_added: string[];
    instruction_changed: boolean;
    instruction_changes: string[];
    context_diff: Record<string, unknown>;
    instruction_diff: Record<string, unknown>;
    warnings: string[];
    likely_cause: boolean;
    cause_confidence: number;
    cause_reason?: string | null;
  } | null;
};

export type Prompt = {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  created_at: string;
};

export type PromptVersion = {
  id: string;
  prompt_id: string;
  version: number;
  content: string;
  hash: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type PromptVersionMetrics = {
  prompt_version_id: string;
  total_spans: number;
  failures: number;
  errors: number;
  failure_rate: number;
  error_rate: number;
  avg_latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type Artifact = {
  id: string;
  run_id: string;
  span_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
};

export type ArtifactSearchResult = {
  run_id: string;
  span_id: string;
  artifact_id: string;
  span_type: string;
  error_type?: string | null;
  model?: string | null;
  snippet: string;
  rank: number;
};

export type ArtifactSearchResponse = {
  results: ArtifactSearchResult[];
  total: number;
};

export type ArtifactSearchFilters = {
  query: string;
  error_type?: string;
  model?: string;
  span_type?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
};

export type RunInsight = {
  id: string;
  run_id: string;
  type?: string;
  insight_type: string;
  severity: string;
  confidence?: number;
  is_primary: boolean;
  title: string;
  summary?: string;
  reason?: string;
  cause: string;
  impact: string;
  fix: string[];
  message: string;
  recommendation: string;
  fix_suggestions: {
    title: string;
    description: string;
    action_type: "prompt" | "validation" | "retry" | "config" | string;
    confidence: number;
  }[];
  created_at: string;
  evidence: Record<string, unknown>;
  impact_score: number;
  related_transition_from_span_id?: string | null;
  related_transition_to_span_id?: string | null;
  cause_confidence?: "high" | "medium" | "low" | string | null;
  derived_from_transition?: boolean;
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

export type InstructionChange = {
  source_id: string;
  source_type: string;
  path: string;
  name: string;
  hash: string;
};

export type InstructionChanged = {
  source_id: string;
  source_type: string;
  path: string;
  name: string;
  previous_hash: string;
  current_hash: string;
  impact_level: "low" | "medium" | "high" | string;
};

export type InstructionDiff = {
  added: InstructionChange[];
  removed: InstructionChange[];
  changed: InstructionChanged[];
  removed_constraints: string[];
  impact_level: "low" | "medium" | "high" | string;
};

export type RunComparison = {
  run_a: Run;
  run_b: Run;
  recommendation: {
    winner: "run_a" | "run_b";
    confidence: number;
    reasons: string[];
    improvements: string[];
    regressions: string[];
    summary: string;
  };
  summary: {
    status_changed: boolean;
    token_delta: number;
    cost_delta: number;
    span_count_delta: number;
    instruction_change_count: number;
    instruction_impact_level: "low" | "medium" | "high" | string;
  };
  diffs: {
    prompts: ArtifactDiff[];
    responses: ArtifactDiff[];
    instruction_diff: InstructionDiff;
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
  insights: {
    insight_type: string;
    summary: string;
    key_changes: string[];
    verdict: string;
    recommendation: string;
    winner: "run_a" | "run_b";
  };
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
    role: string;
    memberships: Membership[];
    permissions: string[];
    is_admin: boolean;
    is_super_admin: boolean;
  };
  onboarding: OnboardingState;
};

export type AdminTelemetryResponse = {
  total_events: number;
  active_projects: number;
  events_today: number;
  events_last_7_days: number;
  error_rate: number;
  daily_active_projects: Array<{
    day: string;
    active_projects: number;
  }>;
  sdk_usage: Array<{
    sdk: string;
    events: number;
  }>;
  version_adoption: Array<{
    sdk_version: string;
    events: number;
  }>;
  events_per_day: Array<{
    day: string;
    events: number;
    error_rate: number;
  }>;
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

export type ProjectStorageSettings = {
  project_id: string;
  retention_days: number | null;
  store_prompts_responses: boolean;
  compress_old_runs: boolean;
  redact_sensitive_data: boolean;
  require_authentication: boolean;
  cleanup_mode: "soft_delete" | "hard_delete";
  updated_at: string;
};

export type UpdateProjectStorageSettingsRequest = {
  retention_days: number | null;
  store_prompts_responses: boolean;
  compress_old_runs: boolean;
  redact_sensitive_data: boolean;
  require_authentication: boolean;
  cleanup_mode: "soft_delete" | "hard_delete";
};

export type RetentionApplyResult = {
  affected_runs: number;
  mode: "soft_delete" | "hard_delete";
  cutoff_at: string | null;
};

export type BillingOverview = {
  plan: "free" | "pro";
  status: string;
  runs_used: number;
  run_limit: number;
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

export type ActiveAlert = {
  id: string;
  project_id: string;
  alert_type: string;
  severity: string;
  message: string;
  evidence: Record<string, unknown>;
  created_at: string;
};

export type AlertEvent = {
  id: string;
  alert_id: string;
  triggered_at: string;
  payload: Record<string, unknown>;
};

export type ProjectAlertEvent = {
  id: string;
  project_id: string;
  alert_type: "new_issue" | "regression" | "cost_spike" | "weekly_report" | string;
  issue_key?: string | null;
  message: string;
  severity: string;
  created_at: string;
};

export type FailureCluster = {
  id: string;
  project_id: string;
  cluster_key: string;
  error_type: string;
  count: number;
  sample_run_ids: string[];
  common_span: string | null;
  created_at: string;
};

export type IssueIntelligence = {
  issue_key: string;
  category: string;
  subcategory: string;
  frequency: number;
  cost_impact: number;
  priority_score: number;
  summary?: string | null;
  root_cause?: string | null;
  recommended_fix?: string | null;
  expected_impact?: string | null;
  confidence_score?: number | null;
  last_seen?: string | null;
};

export type IssueImpactSlice = {
  failure_rate: number;
  cost: number;
};

export type IssueImpactImprovement = {
  failure_delta: number;
  cost_saved: number;
};

export type IssueImpact = {
  before: IssueImpactSlice;
  after: IssueImpactSlice;
  improvement: IssueImpactImprovement;
};

export type IssueImpactResponse = IssueImpact | "processing" | null;

export type WeeklyReport = {
  id: string;
  project_id: string;
  week_start: string;
  week_end: string;
  total_runs: number;
  failure_rate_before: number;
  failure_rate_after: number;
  cost_before: number;
  cost_after: number;
  improvement_summary: string;
  report_json: {
    summary?: {
      failure_change?: number;
      cost_change?: number;
      total_runs?: number;
    };
    top_fixed_issues?: Array<{
      issue_key: string;
      fixed_at: string;
      auto_detected?: boolean;
      detection_confidence?: number | null;
    }>;
    regressions?: Array<{
      issue_key: string;
      detected_at: string;
      regression_severity?: number;
    }>;
    top_issues?: Array<{
      issue_key: string;
      priority_score?: number;
    }>;
  };
  created_at: string;
};

export type RunReplay = {
  id: string;
  original_run_id: string;
  current_step: number;
  state: Record<string, unknown>;
  created_at: string;
};

export type ReplayStep = {
  index: number;
  span: Span;
  artifacts: Artifact[];
};

export type ReplayArtifactDiff = {
  artifact_id: string;
  original_artifact_id: string | null;
  span_id: string | null;
  kind: string;
  original_payload: Record<string, unknown>;
  replay_payload: Record<string, unknown>;
};

export type ReplayDiff = {
  original_run_id: string;
  replay_run_id: string | null;
  modified_artifacts: ReplayArtifactDiff[];
};

export type ReplayResponse = {
  replay: RunReplay;
  active_run_id: string;
  total_steps: number;
  next_step: ReplayStep | null;
  forked_run: Run | null;
  diff: ReplayDiff;
};

export type StartReplayRequest = {
  original_run_id: string;
};

export type ModifyReplayRequest = {
  artifact_id?: string;
  span_id?: string;
  kind?: string;
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
  membership_state: "active" | "pending";
  joined_at: string;
};

export type InviteRecord = {
  id: string;
  email: string;
  project_id?: string | null;
  organization_id: string;
  role: string;
  invite_state: "pending" | "active";
  token: string;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
};

export type ContactRequestPayload = {
  email: string;
  message: string;
  run_id?: string;
};

export type ContactRequestResponse = {
  success: boolean;
};

export type ContactRequestItem = {
  id: string;
  email: string;
  message: string;
  run_id?: string | null;
  created_at: string;
};

export type AdminContactRequestsResponse = {
  requests: ContactRequestItem[];
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

async function putRequestWithBody<T>(path: string, payload: unknown): Promise<T> {
  const response = await api.put<T>(path, payload);
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

export async function searchArtifacts(filters: ArtifactSearchFilters): Promise<ArtifactSearchResponse> {
  const params = new URLSearchParams();
  params.set("query", filters.query);

  if (filters.error_type) params.set("error_type", filters.error_type);
  if (filters.model) params.set("model", filters.model);
  if (filters.span_type) params.set("span_type", filters.span_type);
  if (typeof filters.limit === "number") params.set("limit", String(filters.limit));
  if (typeof filters.offset === "number") params.set("offset", String(filters.offset));

  for (const tag of filters.tags ?? []) {
    const trimmed = tag.trim();
    if (trimmed) params.append("tags", trimmed);
  }

  return request<ArtifactSearchResponse>(`/v1/search?${params.toString()}`);
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

export async function getProjectIssues(projectId: string, limit = 20): Promise<IssueIntelligence[]> {
  const normalizedLimit = Math.max(1, Math.min(20, limit));
  try {
    return await request<IssueIntelligence[]>(`/api/projects/${projectId}/issues?limit=${normalizedLimit}`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function markIssueFixed(projectId: string, issueKey: string): Promise<void> {
  await postRequest(`/api/projects/${projectId}/issues/${encodeURIComponent(issueKey)}/fix`);
}

export async function getIssueImpact(projectId: string, issueKey: string): Promise<IssueImpactResponse> {
  try {
    return await request<IssueImpactResponse>(`/api/projects/${projectId}/issues/${encodeURIComponent(issueKey)}/impact`);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function getProjectWeeklyReport(projectId: string): Promise<WeeklyReport | null> {
  try {
    return await request<WeeklyReport>(`/api/projects/${projectId}/reports/weekly`);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

export async function triggerProjectWeeklyReport(
  projectId: string,
  payload?: { week_start?: string; week_end?: string },
): Promise<WeeklyReport | null> {
  try {
    return await postRequestWithBody<WeeklyReport | null>(
      `/api/projects/${projectId}/reports/weekly/trigger`,
      payload ?? {},
    );
  } catch (error) {
    if (isNotFound(error)) {
      return null;
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
          role: "user",
          memberships: [],
          permissions: [],
          is_admin: false,
          is_super_admin: false,
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

export async function getAdminTelemetry(): Promise<AdminTelemetryResponse> {
  return request<AdminTelemetryResponse>("/api/admin/telemetry");
}

export async function createContactRequest(
  payload: ContactRequestPayload,
): Promise<ContactRequestResponse> {
  return postRequestWithBody<ContactRequestResponse>("/api/contact", payload);
}

export async function getAdminContactRequests(): Promise<AdminContactRequestsResponse> {
  return request<AdminContactRequestsResponse>("/api/admin/contact-requests");
}

export async function getProjectStorageSettings(projectId: string): Promise<ProjectStorageSettings> {
  return request<ProjectStorageSettings>(`/v1/projects/${projectId}/storage-settings`);
}

export async function getProjectBilling(projectId: string): Promise<BillingOverview> {
  return request<BillingOverview>(`/v1/projects/${projectId}/billing`);
}

export async function createBillingCheckout(
  projectId: string,
  payload: { success_url: string; cancel_url: string },
): Promise<{ checkout_url: string }> {
  return postRequestWithBody<{ checkout_url: string }>(`/v1/projects/${projectId}/billing/checkout`, payload);
}

export async function updateProjectStorageSettings(
  projectId: string,
  payload: UpdateProjectStorageSettingsRequest,
): Promise<ProjectStorageSettings> {
  return putRequestWithBody<ProjectStorageSettings>(`/v1/projects/${projectId}/storage-settings`, payload);
}

export async function applyProjectRetention(projectId: string): Promise<RetentionApplyResult> {
  return postRequestWithBody<RetentionApplyResult>(`/v1/projects/${projectId}/storage-settings/apply`, {});
}

export async function deleteAllProjectData(projectId: string): Promise<RetentionApplyResult> {
  return postRequestWithBody<RetentionApplyResult>(`/v1/projects/${projectId}/storage-settings/delete-all`, {});
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

export async function getActiveAlerts(projectId: string): Promise<ActiveAlert[]> {
  try {
    return await request<ActiveAlert[]>(`/v1/projects/${projectId}/alerts/active`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getProjectAlerts(projectId: string): Promise<ProjectAlertEvent[]> {
  try {
    return await request<ProjectAlertEvent[]>(`/api/projects/${projectId}/alerts`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function getFailureClusters(projectId: string): Promise<FailureCluster[]> {
  try {
    return await request<FailureCluster[]>(`/v1/projects/${projectId}/failure-clusters`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function createOrgInvite(
  organizationId: string,
  payload: { email: string; role: "admin" | "member" },
): Promise<InviteRecord> {
  return postRequestWithBody<InviteRecord>(`/v1/orgs/${organizationId}/invites`, payload);
}

export async function createProjectInvite(
  projectId: string,
  payload: { email: string; role: "admin" | "member" },
): Promise<InviteRecord> {
  return postRequestWithBody<InviteRecord>(`/v1/projects/${projectId}/invite`, payload);
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

export async function updateOrgMemberRole(
  organizationId: string,
  userId: string,
  role: "admin" | "member",
): Promise<void> {
  await putRequestWithBody<void>(`/v1/orgs/${organizationId}/members/${userId}`, { role });
}

export async function getOrgPendingInvites(organizationId: string): Promise<InviteRecord[]> {
  try {
    return await request<InviteRecord[]>(`/v1/orgs/${organizationId}/invites`);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
}

export async function resendOrgInvite(organizationId: string, inviteId: string): Promise<InviteRecord> {
  return postRequestWithBody<InviteRecord>(`/v1/orgs/${organizationId}/invites/${inviteId}/resend`, {});
}

export async function cancelOrgInvite(organizationId: string, inviteId: string): Promise<void> {
  await deleteRequest(`/v1/orgs/${organizationId}/invites/${inviteId}`);
}

export async function createProjectApiKey(projectId: string): Promise<ProjectApiKeyResponse> {
  return postRequest<ProjectApiKeyResponse>(`/v1/projects/${projectId}/api-keys`);
}

export async function startReplay(payload: StartReplayRequest): Promise<ReplayResponse> {
  return postRequestWithBody<ReplayResponse>("/v1/replay/start", payload);
}

export async function stepReplay(replayId: string): Promise<ReplayResponse> {
  return postRequestWithBody<ReplayResponse>(`/v1/replay/${replayId}/step`, {});
}

export async function modifyReplay(replayId: string, payload: ModifyReplayRequest): Promise<ReplayResponse> {
  return postRequestWithBody<ReplayResponse>(`/v1/replay/${replayId}/modify`, payload);
}

export async function resumeReplay(replayId: string): Promise<ReplayResponse> {
  return postRequestWithBody<ReplayResponse>(`/v1/replay/${replayId}/resume`, {});
}
