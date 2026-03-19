"use client";

import { useEffect, useState } from "react";
import { Bell, Copy, Database, Key, Loader2, RefreshCcw, Shield } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import {
  applyProjectRetention,
  createProjectApiKey,
  getCurrentUser,
  getProjectStorageSettings,
  updateProjectStorageSettings,
  type RetentionApplyResult,
  type UpdateProjectStorageSettingsRequest,
} from "@/lib/api";

function retentionValueToDays(value: string): number | null {
  if (value === "forever") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function retentionDaysToValue(days: number | null): string {
  if (days === null) return "forever";
  if ([7, 30, 90, 365].includes(days)) return String(days);
  return "30";
}

export default function SettingsPage() {
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);
  const [canGenerateApiKey, setCanGenerateApiKey] = useState(false);
  const [canManageProject, setCanManageProject] = useState(false);
  const [loadingApiKeyContext, setLoadingApiKeyContext] = useState(true);
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isGeneratingApiKey, setIsGeneratingApiKey] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  const [retention, setRetention] = useState("30");
  const [storePromptsResponses, setStorePromptsResponses] = useState(true);
  const [compressOldRuns, setCompressOldRuns] = useState(false);
  const [cleanupMode, setCleanupMode] = useState<"soft_delete" | "hard_delete">("soft_delete");
  const [storageLoading, setStorageLoading] = useState(true);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageApplying, setStorageApplying] = useState(false);
  const [storageMessage, setStorageMessage] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastApplyResult, setLastApplyResult] = useState<RetentionApplyResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getCurrentUser();
        if (cancelled) return;

        const projectId = me.onboarding.default_project_id;
        setDefaultProjectId(projectId);

        const hasProjectManage = me.user.permissions.includes("project:manage");
        const hasApiKeyCreate = me.user.permissions.includes("api_key:create");
        setCanGenerateApiKey(hasProjectManage && hasApiKeyCreate);
        setCanManageProject(hasProjectManage);

        if (!projectId) {
          setStorageLoading(false);
          return;
        }

        const settings = await getProjectStorageSettings(projectId);
        if (cancelled) return;

        setRetention(retentionDaysToValue(settings.retention_days));
        setStorePromptsResponses(settings.store_prompts_responses);
        setCompressOldRuns(settings.compress_old_runs);
        setCleanupMode(settings.cleanup_mode);
      } catch {
        if (cancelled) return;
        setApiKeyError("Failed to load API key permissions.");
        setStorageError("Failed to load storage settings.");
      } finally {
        if (!cancelled) {
          setLoadingApiKeyContext(false);
          setStorageLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerateApiKey() {
    if (!defaultProjectId || !canGenerateApiKey) return;

    setIsGeneratingApiKey(true);
    setApiKeyError(null);

    try {
      const response = await createProjectApiKey(defaultProjectId);
      setGeneratedApiKey(response.api_key);
      setCopiedApiKey(false);
    } catch {
      setApiKeyError("Unable to generate a new API key. Check your permissions and try again.");
    } finally {
      setIsGeneratingApiKey(false);
    }
  }

  async function handleCopyApiKey() {
    if (!generatedApiKey) return;
    await navigator.clipboard.writeText(generatedApiKey);
    setCopiedApiKey(true);
    window.setTimeout(() => setCopiedApiKey(false), 1500);
  }

  async function handleSaveStorageSettings() {
    if (!defaultProjectId || !canManageProject) return;

    setStorageSaving(true);
    setStorageError(null);
    setStorageMessage(null);

    const payload: UpdateProjectStorageSettingsRequest = {
      retention_days: retentionValueToDays(retention),
      store_prompts_responses: storePromptsResponses,
      compress_old_runs: compressOldRuns,
      cleanup_mode: cleanupMode,
    };

    try {
      const updated = await updateProjectStorageSettings(defaultProjectId, payload);
      setRetention(retentionDaysToValue(updated.retention_days));
      setStorePromptsResponses(updated.store_prompts_responses);
      setCompressOldRuns(updated.compress_old_runs);
      setCleanupMode(updated.cleanup_mode);
      setStorageMessage("Storage settings saved.");
    } catch {
      setStorageError("Failed to save storage settings.");
    } finally {
      setStorageSaving(false);
    }
  }

  async function handleApplyRetention() {
    if (!defaultProjectId || !canManageProject) return;

    setStorageApplying(true);
    setStorageError(null);
    setStorageMessage(null);

    try {
      const result = await applyProjectRetention(defaultProjectId);
      setLastApplyResult(result);
      setStorageMessage(`Retention applied. ${result.affected_runs} run(s) processed via ${result.mode}.`);
    } catch {
      setStorageError("Failed to apply retention policy.");
    } finally {
      setStorageApplying(false);
    }
  }

  return (
    <AppShell activePath="/settings">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Settings</h1>
          <p className="text-gray-600">Configure your AgentScope environment</p>
        </div>

        <div className="max-w-3xl space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Key className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Project API Keys</h2>
            </div>

            <div className="space-y-3">
              {defaultProjectId ? (
                <p className="text-sm text-gray-600">Default project: <span className="font-mono">{defaultProjectId}</span></p>
              ) : (
                <p className="text-sm text-gray-600">No default project found for this account.</p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleGenerateApiKey}
                  disabled={loadingApiKeyContext || isGeneratingApiKey || !defaultProjectId || !canGenerateApiKey}
                  className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  {isGeneratingApiKey ? "Generating..." : "Generate New API Key"}
                </button>
                {generatedApiKey ? (
                  <button
                    type="button"
                    onClick={handleCopyApiKey}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {copiedApiKey ? "Copied" : "Copy Key"}
                  </button>
                ) : null}
              </div>

              {!loadingApiKeyContext && !canGenerateApiKey ? (
                <p className="text-xs text-amber-700">
                  You need <span className="font-mono">project:manage</span> and <span className="font-mono">api_key:create</span> permissions to generate keys.
                </p>
              ) : null}

              {generatedApiKey ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-xs font-medium text-emerald-900">New key (shown once):</p>
                  <p className="mt-1 break-all font-mono text-sm text-emerald-900">{generatedApiKey}</p>
                </div>
              ) : null}

              {apiKeyError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{apiKeyError}</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Bell className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Notifications</h2>
            </div>
            <div className="space-y-4">
              {[
                ["Failed Run Alerts", "Get notified when a run fails", true],
                ["High Latency Warnings", "Alert when latency exceeds threshold", true],
                ["Token Usage Alerts", "Notify when approaching token limits", false],
                ["Daily Summary", "Receive daily performance summary", false],
              ].map(([title, desc, checked]) => (
                <div key={String(title)} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{title}</p>
                    <p className="text-sm text-gray-600">{desc}</p>
                  </div>
                  <input defaultChecked={Boolean(checked)} type="checkbox" className="h-4 w-4" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Storage & Retention</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="retention" className="text-sm font-medium text-gray-900">
                  Run History Retention
                </label>
                <select
                  id="retention"
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={retention}
                  onChange={(event) => setRetention(event.target.value)}
                  disabled={storageLoading || !canManageProject}
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                  <option value="forever">Forever</option>
                </select>
              </div>

              <div>
                <label htmlFor="cleanup-mode" className="text-sm font-medium text-gray-900">
                  Cleanup Mode
                </label>
                <select
                  id="cleanup-mode"
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={cleanupMode}
                  onChange={(event) => setCleanupMode(event.target.value as "soft_delete" | "hard_delete")}
                  disabled={storageLoading || !canManageProject}
                >
                  <option value="soft_delete">Soft delete (hide runs)</option>
                  <option value="hard_delete">Hard delete (permanent)</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Store Prompts & Responses</p>
                  <p className="text-sm text-gray-600">When disabled, prompt/response payloads are redacted on ingest.</p>
                </div>
                <input
                  checked={storePromptsResponses}
                  onChange={(event) => setStorePromptsResponses(event.target.checked)}
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={storageLoading || !canManageProject}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Compress Old Runs</p>
                  <p className="text-sm text-gray-600">Reserved for future optimization workflows.</p>
                </div>
                <input
                  checked={compressOldRuns}
                  onChange={(event) => setCompressOldRuns(event.target.checked)}
                  type="checkbox"
                  className="h-4 w-4"
                  disabled={storageLoading || !canManageProject}
                />
              </div>

              {!canManageProject ? (
                <p className="text-xs text-amber-700">You need <span className="font-mono">project:manage</span> permission to change retention settings.</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSaveStorageSettings}
                  disabled={storageLoading || storageSaving || !defaultProjectId || !canManageProject}
                  className="inline-flex items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {storageSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {storageSaving ? "Saving..." : "Save Storage Settings"}
                </button>
                <button
                  type="button"
                  onClick={handleApplyRetention}
                  disabled={storageLoading || storageApplying || !defaultProjectId || !canManageProject}
                  className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {storageApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {storageApplying ? "Applying..." : "Apply Retention Now"}
                </button>
              </div>

              {storageMessage ? <p className="text-sm text-emerald-700">{storageMessage}</p> : null}
              {storageError ? <p className="text-sm text-red-700">{storageError}</p> : null}

              {lastApplyResult ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <p>Mode: <span className="font-mono">{lastApplyResult.mode}</span></p>
                  <p>Affected runs: <span className="font-mono">{lastApplyResult.affected_runs}</span></p>
                  <p>Cutoff: <span className="font-mono">{lastApplyResult.cutoff_at ?? "none"}</span></p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-gray-600" />
              <h2 className="text-base font-medium text-gray-900">Security</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Redact Sensitive Data</p>
                  <p className="text-sm text-gray-600">Automatically redact PII in logs</p>
                </div>
                <input defaultChecked type="checkbox" className="h-4 w-4" />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Require Authentication</p>
                  <p className="text-sm text-gray-600">Enforce login for all users</p>
                </div>
                <input defaultChecked type="checkbox" className="h-4 w-4" />
              </div>
              <div>
                <label htmlFor="session-timeout" className="text-sm font-medium text-gray-900">
                  Session Timeout (minutes)
                </label>
                <input
                  id="session-timeout"
                  type="number"
                  defaultValue="60"
                  min="5"
                  max="1440"
                  className="mt-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
