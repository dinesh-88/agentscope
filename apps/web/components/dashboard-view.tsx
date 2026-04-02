"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, DollarSign, Gauge, Timer, Wrench } from "lucide-react";

import { useAppTheme } from "@/components/app-shell";
import { type Run, type Span } from "@/lib/api";

function durationMs(run: Run) {
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function spanDurationMs(span: Span) {
  if (typeof span.latency_ms === "number" && Number.isFinite(span.latency_ms)) {
    return Math.max(0, span.latency_ms);
  }
  const start = new Date(span.started_at).getTime();
  const end = span.ended_at ? new Date(span.ended_at).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function normalizeStatus(status: string) {
  if (status === "success") return "completed";
  if (status === "error") return "failed";
  return status;
}

type IssueItem = {
  issue_key: string;
  category: string;
  subcategory: string;
  count: number;
};

function classifyFailureType(span: Span): string {
  const errorType = (span.error_type ?? "").trim().toLowerCase();
  const errorSource = (span.error_source ?? "").trim().toLowerCase();
  const transitionReason = (span.step_transition?.cause_reason ?? "").trim().toLowerCase();

  if (errorType && errorType !== "unknown" && errorType !== "unknown_failure") {
    return errorType;
  }

  if (transitionReason.includes("token") || transitionReason.includes("context")) {
    return "context_issue:context_overflow";
  }
  if (transitionReason.includes("json") || transitionReason.includes("schema")) {
    return "tool_error:schema_invalid";
  }
  if (transitionReason.includes("timeout")) {
    return "latency:timeout";
  }

  if (errorSource === "tool") return "tool_error:execution_failed";
  if (errorSource === "provider") return "system_error:provider_failure";
  if (errorSource === "system") return "system_error:runtime_failure";

  return "unknown_failure";
}

function issueFromFailureType(failureType: string, count: number): IssueItem {
  const normalized = failureType.trim().toLowerCase();
  if (normalized === "unknown" || normalized === "unknown_failure" || normalized === "") {
    return {
      issue_key: "uncategorized:runtime_failure",
      category: "uncategorized",
      subcategory: "runtime_failure",
      count,
    };
  }

  if (normalized.includes(":")) {
    const [category, ...rest] = normalized.split(":");
    const subcategory = rest.join(":") || "general";
    return {
      issue_key: `${category}:${subcategory}`,
      category: category || "uncategorized",
      subcategory,
      count,
    };
  }

  return {
    issue_key: `${normalized}:general`,
    category: normalized,
    subcategory: "general",
    count,
  };
}

function TopIssuesPanel({
  issues,
  onSelectIssue,
}: {
  issues: IssueItem[];
  onSelectIssue: (issue: IssueItem) => void;
}) {
  return (
    <div className="mb-8 rounded-xl border border-white/10 bg-[#101722] p-6">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle className="size-4 text-orange-300" />
        <h2 className="text-base font-medium text-gray-100">Top Issues</h2>
      </div>
      {issues.length === 0 ? (
        <p className="text-sm text-gray-400">No issue signals available.</p>
      ) : (
        <div className="space-y-2">
          {issues.map((issue) => (
            <button
              key={issue.issue_key}
              type="button"
              onClick={() => onSelectIssue(issue)}
              className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/[0.05]"
            >
              <span className="truncate">{issue.issue_key}</span>
              <span className="ml-3 text-gray-300">{issue.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function IssueDetailPanel({
  issue,
  onClose,
}: {
  issue: IssueItem | null;
  onClose: () => void;
}) {
  if (!issue) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#101722] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Issue Detail</p>
            <h3 className="mt-1 text-lg font-semibold text-gray-100">{issue.issue_key}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-200 hover:bg-white/[0.05]"
          >
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Category</p>
            <p className="mt-1 text-sm text-gray-100">{issue.category}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-400">Subcategory</p>
            <p className="mt-1 text-sm text-gray-100">{issue.subcategory}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DashboardView({ runs, spansByRun }: { runs: Run[]; spansByRun: Record<string, Span[]> }) {
  const { theme } = useAppTheme();
  const dark = theme === "dark";
  const [selectedIssue, setSelectedIssue] = useState<IssueItem | null>(null);

  const totalRuns = runs.length;
  const successfulRuns = runs.filter((run) => normalizeStatus(run.status) === "completed").length;
  const failedRuns = runs.filter((run) => normalizeStatus(run.status) === "failed").length;
  const runLatencies = runs.map(durationMs).filter((value) => Number.isFinite(value));
  const avgLatency = runLatencies.length > 0 ? runLatencies.reduce((sum, value) => sum + value, 0) / runLatencies.length : 0;
  const p95Latency = percentile(runLatencies, 95);
  const tokenUsage = runs.reduce((sum, run) => sum + (run.total_tokens ?? 0), 0);
  const avgCost = runs.length > 0 ? runs.reduce((sum, run) => sum + (run.total_cost_usd ?? 0), 0) / runs.length : 0;

  const allSpans = Object.values(spansByRun).flat();
  const failureTypeCounts = new Map<string, number>();
  const rootCauseCounts = new Map<string, number>();
  const dayFailures = new Map<string, number>();

  for (const span of allSpans) {
    const isFailed = span.status === "failed" || span.status === "error";
    if (!isFailed) continue;
    const failureType = classifyFailureType(span);
    failureTypeCounts.set(failureType, (failureTypeCounts.get(failureType) ?? 0) + 1);

    const rootCause =
      span.step_transition?.cause_reason ??
      (span.step_transition?.likely_cause ? "step transition likely caused failure" : null) ??
      span.error_source ??
      "unknown_root_cause";
    rootCauseCounts.set(rootCause, (rootCauseCounts.get(rootCause) ?? 0) + 1);

    const day = new Date(span.started_at).toISOString().slice(0, 10);
    dayFailures.set(day, (dayFailures.get(day) ?? 0) + 1);
  }

  const topFailureTypes = [...failureTypeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topRootCauses = [...rootCauseCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const failureTrend = [...dayFailures.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  const slowestSpans = [...allSpans].sort((a, b) => spanDurationMs(b) - spanDurationMs(a)).slice(0, 6);

  const recentRuns = [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 5);
  const topIssues = useMemo<IssueItem[]>(
    () => topFailureTypes.map(([failureType, count]) => issueFromFailureType(failureType, count)),
    [topFailureTypes],
  );

  const runHealthCards = [
    { title: "Total Runs", value: totalRuns.toLocaleString(), icon: Activity },
    { title: "Success / Failed", value: `${successfulRuns} / ${failedRuns}`, icon: AlertTriangle },
    { title: "Avg Latency", value: formatDuration(avgLatency), icon: Timer },
    { title: "Avg Cost", value: `$${avgCost.toFixed(4)}`, icon: DollarSign },
  ];

  function statusBadge(status: string) {
    switch (status) {
      case "completed":
        return dark ? "bg-green-500/20 text-green-300" : "bg-green-100 text-green-800";
      case "running":
        return dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-800";
      case "failed":
        return dark ? "bg-red-500/20 text-red-300" : "bg-red-100 text-red-800";
      case "pending":
        return dark ? "bg-gray-500/20 text-gray-300" : "bg-gray-100 text-gray-800";
      default:
        return dark ? "bg-gray-500/20 text-gray-300" : "bg-gray-100 text-gray-800";
    }
  }

  return (
    <div className={dark ? "bg-[#0B0F14] p-8" : "bg-gray-50 p-8"}>
      <div className="mb-8">
        <h1 className={dark ? "mb-2 text-2xl font-semibold text-gray-100" : "mb-2 text-2xl font-semibold text-gray-900"}>Debug Dashboards</h1>
        <p className={dark ? "text-gray-400" : "text-gray-600"}>Focus on failure clarity, trend shifts, and performance bottlenecks.</p>
      </div>

      <div className="mb-8 rounded-xl border border-white/10 bg-[#101722] p-6">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="size-4 text-blue-300" />
          <h2 className="text-base font-medium text-gray-100">Run Health</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {runHealthCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.title} className={dark ? "rounded-xl border border-white/10 bg-[#0f1520] p-4" : "rounded-xl border border-gray-200 bg-white p-4"}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={dark ? "text-sm text-gray-400" : "text-sm text-gray-600"}>{stat.title}</p>
                    <p className={dark ? "mt-2 text-2xl font-semibold text-gray-100" : "mt-2 text-2xl font-semibold text-gray-900"}>{stat.value}</p>
                  </div>
                  <div className="rounded-lg bg-white/5 p-2">
                    <Icon className="h-5 w-5 text-gray-200" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <TopIssuesPanel issues={topIssues} onSelectIssue={(issue) => setSelectedIssue(issue)} />

      <div className="mb-8 rounded-xl border border-white/10 bg-[#101722] p-6">
        <div className="mb-4 flex items-center gap-2">
          <Wrench className="size-4 text-amber-300" />
          <h2 className="text-base font-medium text-gray-100">Failure Analysis</h2>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-400">Failure Types</p>
            <div className="space-y-2">
              {topFailureTypes.length === 0 ? (
                <p className="text-sm text-gray-400">No failure spans found in recent runs.</p>
              ) : (
                topFailureTypes.map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-gray-200">
                    <span className="truncate">{type}</span>
                    <span>{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-400">Failure Trend (7d)</p>
            <div className="space-y-2">
              {failureTrend.length === 0 ? (
                <p className="text-sm text-gray-400">Not enough data for trend.</p>
              ) : (
                failureTrend.map(([day, count]) => (
                  <div key={day} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-gray-200">
                    <span>{day}</span>
                    <span>{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-400">Top Root Causes</p>
            <div className="space-y-2">
              {topRootCauses.length === 0 ? (
                <p className="text-sm text-gray-400">No root-cause signals captured.</p>
              ) : (
                topRootCauses.map(([reason, count]) => (
                  <div key={reason} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-gray-200">
                    <div className="line-clamp-2">{reason}</div>
                    <div className="mt-1 text-xs text-gray-400">{count} spans</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8 rounded-xl border border-white/10 bg-[#101722] p-6">
        <div className="mb-4 flex items-center gap-2">
          <Gauge className="size-4 text-emerald-300" />
          <h2 className="text-base font-medium text-gray-100">Performance</h2>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-gray-400">Avg Latency</p>
            <p className="mt-1 text-xl font-semibold text-gray-100">{formatDuration(avgLatency)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-gray-400">P95 Latency</p>
            <p className="mt-1 text-xl font-semibold text-gray-100">{formatDuration(p95Latency)}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-sm text-gray-400">Token Usage</p>
            <p className="mt-1 text-xl font-semibold text-gray-100">{tokenUsage.toLocaleString()}</p>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-400">Slowest Spans</p>
          <div className="space-y-2">
            {slowestSpans.length === 0 ? (
              <p className="text-sm text-gray-400">No span latency data available.</p>
            ) : (
              slowestSpans.map((span) => (
                <Link
                  key={span.id}
                  href={`/runs/${span.run_id}`}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-gray-200 hover:bg-white/[0.05]"
                >
                  <span className="truncate">{span.name}</span>
                  <span className="ml-3">{formatDuration(spanDurationMs(span))}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>

      <div className={dark ? "rounded-xl border border-white/10 bg-[#101722]" : "rounded-xl border border-gray-200 bg-white"}>
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className={dark ? "text-base font-medium text-gray-100" : "text-base font-medium text-gray-900"}>Recent Runs</h2>
          <Link href="/runs" className={dark ? "text-sm text-blue-300 hover:text-blue-200" : "text-sm text-blue-600 hover:text-blue-700"}>
            View all
          </Link>
        </div>

        <div className="px-6 pb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={dark ? "border-b border-white/10" : "border-b border-gray-200"}>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Run Name</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Agent</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Status</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Duration</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Tokens</th>
                </tr>
              </thead>
              <tbody className={dark ? "divide-y divide-white/10" : "divide-y divide-gray-100"}>
                {recentRuns.map((run) => {
                  const status = normalizeStatus(run.status);
                  return (
                    <tr key={run.id} className={dark ? "hover:bg-white/5" : "hover:bg-gray-50"}>
                      <td className="py-4">
                        <Link href={`/runs/${run.id}`} className={dark ? "text-sm font-medium text-gray-100 hover:text-blue-300" : "text-sm font-medium text-gray-900 hover:text-blue-600"}>
                          {run.workflow_name}
                        </Link>
                      </td>
                      <td className={dark ? "py-4 text-sm text-gray-300" : "py-4 text-sm text-gray-600"}>{run.agent_name}</td>
                      <td className="py-4">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${statusBadge(status)}`}>{status}</span>
                      </td>
                      <td className={dark ? "py-4 text-sm text-gray-300" : "py-4 text-sm text-gray-600"}>{formatDuration(durationMs(run))}</td>
                      <td className={dark ? "py-4 text-sm text-gray-300" : "py-4 text-sm text-gray-600"}>{(run.total_tokens ?? 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <IssueDetailPanel issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
    </div>
  );
}
