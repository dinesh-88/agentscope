"use client";

import {
  Activity,
  ArrowLeft,
  Download,
  FileText,
  Filter,
  GitBranch,
  Search,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { RunTimelineView } from "@/components/run-timeline-view";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";

function formatDurationMs(ms: number) {
  if (ms <= 0 || !Number.isFinite(ms)) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function runDurationMs(run: Run) {
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function isFailureStatus(status: string) {
  const value = status.toLowerCase();
  return value === "failed" || value === "error";
}

function isFailureSpan(span: Span) {
  return isFailureStatus(span.status) || span.success === false;
}

function formatRelativeStartedAt(startedAt: string) {
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return "Started recently";
  const now = Date.now();
  const diffMs = Math.max(0, now - started);
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "Started just now";
  if (diffMinutes < 60) return `Started ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Started ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `Started ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (value === "failed" || value === "error") return "failed";
  if (value === "completed" || value === "success") return "success";
  if (value === "running") return "running";
  return "neutral";
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function spanDurationMs(span: Span) {
  if (typeof span.latency_ms === "number" && Number.isFinite(span.latency_ms)) {
    return Math.max(0, span.latency_ms);
  }
  if (!span.started_at || !span.ended_at) return 0;
  const start = new Date(span.started_at).getTime();
  const end = new Date(span.ended_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function severityForSpan(span: Span): "error" | "warning" | "info" {
  const status = span.status.toLowerCase();
  if (status === "failed" || status === "error" || span.success === false) return "error";
  if (status === "warning") return "warning";
  return "info";
}

function readPayloadText(payload: Record<string, unknown>) {
  const candidates = ["message", "error", "summary", "content", "result", "output"];
  for (const key of candidates) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  try {
    return JSON.stringify(payload).slice(0, 280);
  } catch {
    return "Artifact payload";
  }
}

export function RunDetailView({
  run,
  spans,
  artifacts,
  insights,
  rootCause,
}: {
  run: Run;
  spans: Span[];
  artifacts: Artifact[];
  insights: RunInsight[];
  rootCause: RunRootCause | null;
}) {
  const orderedSpans = useMemo(
    () => [...spans].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at)),
    [spans]
  );

  const primaryInsight = useMemo(() => insights.find((item) => item.is_primary) ?? insights[0] ?? null, [insights]);
  const [activeTab, setActiveTab] = useState<"timeline" | "logs" | "traces" | "performance">("timeline");

  const runMs = runDurationMs(run);
  const runStatusIsFailure = isFailureStatus(run.status) || run.success === false;
  const runStatusTone = statusTone(run.status);
  const totalTokens = run.total_tokens ?? orderedSpans.reduce((acc, span) => acc + (span.total_tokens ?? 0), 0);
  const totalCost = run.total_cost_usd ?? orderedSpans.reduce((acc, span) => acc + (span.estimated_cost ?? 0), 0);
  const firstFailedSpan = orderedSpans.find((span) => isFailureSpan(span));
  const slowSpanCount = orderedSpans.filter((span) => spanDurationMs(span) >= 3_000).length;
  const avgSpanLatencyMs =
    orderedSpans.length > 0
      ? orderedSpans.reduce((acc, span) => acc + spanDurationMs(span), 0) / orderedSpans.length
      : 0;
  const p95SpanLatencyMs =
    orderedSpans.length > 0
      ? [...orderedSpans]
          .map((span) => spanDurationMs(span))
          .sort((a, b) => a - b)[Math.max(0, Math.ceil(orderedSpans.length * 0.95) - 1)]
      : 0;
  const spansById = useMemo(() => new Map(orderedSpans.map((span) => [span.id, span])), [orderedSpans]);
  const logEntries = useMemo(() => {
    const spanLogs = orderedSpans.map((span) => ({
      id: `span-${span.id}`,
      at: span.started_at,
      level: severityForSpan(span),
      source: span.tool_name ?? span.name ?? span.span_type,
      message:
        span.error_type ??
        span.error_source ??
        `${span.span_type} ${span.status.toLowerCase()} (${formatDurationMs(spanDurationMs(span))})`,
    }));
    const artifactLogs = artifacts.map((artifact) => {
      const span = artifact.span_id ? spansById.get(artifact.span_id) : undefined;
      return {
        id: `artifact-${artifact.id}`,
        at: span?.started_at ?? run.started_at,
        level: "info" as const,
        source: artifact.kind,
        message: readPayloadText(artifact.payload ?? {}),
      };
    });
    return [...spanLogs, ...artifactLogs].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  }, [orderedSpans, artifacts, spansById, run.started_at]);

  const heroInsightTitle = runStatusIsFailure
    ? (primaryInsight?.title ?? firstFailedSpan?.name ?? run.status.toUpperCase())
    : "No blocking failures detected in this run";

  const heroInsightLine = runStatusIsFailure
    ? (rootCause?.message ?? primaryInsight?.cause ?? firstFailedSpan?.error_type ?? firstFailedSpan?.error_source ?? run.status)
    : "Execution completed without critical failure";
  const heroToneClasses = runStatusIsFailure
    ? {
        container: "border-red-500 from-red-950/50 to-red-900/30",
        icon: "text-red-500",
        title: "text-red-400",
        body: "text-gray-300",
        cta: "text-red-400 hover:text-red-300",
      }
    : {
        container: "border-emerald-500 from-emerald-950/40 to-emerald-900/20",
        icon: "text-emerald-500",
        title: "text-emerald-400",
        body: "text-gray-300",
        cta: "text-emerald-400 hover:text-emerald-300",
      };
  const sortedInsights = [...insights].sort((a, b) => {
    if (a.is_primary === b.is_primary) return 0;
    return a.is_primary ? -1 : 1;
  });

  const logCount = artifacts.length + orderedSpans.length;
  const traceCount = orderedSpans.length;
  const statusLabelClass =
    runStatusTone === "failed"
      ? "bg-red-950/50 border-red-500/50 text-red-400"
      : runStatusTone === "success"
        ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-400"
        : runStatusTone === "running"
          ? "bg-blue-950/40 border-blue-500/40 text-blue-400"
          : "bg-gray-900/60 border-gray-600/50 text-gray-300";
  const statusDotClass =
    runStatusTone === "failed"
      ? "bg-red-500"
      : runStatusTone === "success"
        ? "bg-emerald-500"
        : runStatusTone === "running"
          ? "bg-blue-500"
          : "bg-gray-500";

  const tabs = [
    { id: "timeline" as const, label: "Timeline", icon: Activity, count: null },
    { id: "logs" as const, label: "Logs", icon: FileText, count: logCount },
    { id: "traces" as const, label: "Traces", icon: GitBranch, count: traceCount },
    { id: "performance" as const, label: "Performance", icon: TrendingUp, count: slowSpanCount },
  ];
  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      <div className="border-b border-gray-800 bg-[#0a0a14]/95 backdrop-blur-sm">
        <div className="w-full px-6 py-4">
          <div className="mb-4 flex items-center justify-between">
            <Link href="/runs" className="flex items-center gap-2 text-gray-400 transition-colors hover:text-gray-300">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to runs</span>
            </Link>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm transition-colors hover:bg-gray-700">
                <Search className="h-4 w-4" />
                <span>Search</span>
                <kbd className="rounded bg-gray-700 px-1.5 py-0.5 text-xs">⌘K</kbd>
              </button>
              <button className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm transition-colors hover:bg-gray-700">
                <Filter className="h-4 w-4" />
                <span>Filter</span>
              </button>
              <button className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-1.5 text-sm transition-colors hover:bg-gray-700">
                <Download className="h-4 w-4" />
                <span>Export</span>
              </button>
            </div>
          </div>

          <div>
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-start gap-2">
                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <h1 className="text-2xl font-semibold">{run.workflow_name || run.agent_name || run.id}</h1>
                    <span className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium ${statusLabelClass}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass} ${runStatusTone === "running" ? "animate-pulse" : ""}`} />
                      {run.status.toUpperCase()}
                    </span>
                    <span className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400">{run.id}</span>
                  </div>
                  <p className="text-sm text-gray-400">
                    {formatRelativeStartedAt(run.started_at)} by <span className="text-gray-300">{run.user_id || run.agent_name || "-"}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="mb-1 text-xs text-gray-500">Total Duration</div>
                  <div className="text-lg font-semibold text-white">{formatDurationMs(runMs)}</div>
                </div>
                <div className="text-right">
                  <div className="mb-1 text-xs text-gray-500">Total Cost</div>
                  <div className="text-lg font-semibold text-white">${totalCost.toFixed(4)}</div>
                </div>
                <div className="text-right">
                  <div className="mb-1 text-xs text-gray-500">Tokens Used</div>
                  <div className="text-lg font-semibold text-white">{totalTokens.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className={`rounded-r-lg border-l-4 bg-gradient-to-r p-4 ${heroToneClasses.container}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 h-5 w-5 ${heroToneClasses.icon}`}>⚠</div>
                <div className="flex-1">
                  <div className={`mb-1 font-medium ${heroToneClasses.title}`}>{heroInsightTitle}</div>
                  <p className={`text-sm ${heroToneClasses.body}`}>{heroInsightLine}</p>
                </div>
                {runStatusIsFailure ? (
                  <button className={`whitespace-nowrap text-sm underline ${heroToneClasses.cta}`}>View Fix →</button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-6 py-6">
        {runStatusIsFailure ? (
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-red-900/50 bg-[#0f0f1e] p-4">
              <h3 className="mb-3 text-sm font-semibold text-red-400">Root Cause Analysis</h3>
              <p className="mb-3 text-sm text-gray-300">{rootCause?.message ?? "No root cause message provided."}</p>
              <div className="space-y-1 text-xs text-gray-400">
                <div>
                  Type: <span className="text-gray-300">{rootCause?.root_cause_type ?? "-"}</span>
                </div>
                <div>
                  Confidence:{" "}
                  <span className="text-gray-300">
                    {typeof rootCause?.confidence === "number" ? `${Math.round(rootCause.confidence * 100)}%` : "-"}
                  </span>
                </div>
              </div>
              {rootCause?.suggested_fix ? (
                <div className="mt-3 rounded border border-gray-800 bg-black/20 p-3">
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Suggested Fix</div>
                  <div className="text-sm text-gray-300">{rootCause.suggested_fix}</div>
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-200">Insights</h3>
              {sortedInsights.length === 0 ? (
                <p className="text-sm text-gray-400">No insights available for this failed run.</p>
              ) : (
                <div className="space-y-3">
                  {sortedInsights.slice(0, 4).map((insight) => (
                    <div key={insight.id} className="rounded border border-gray-800 bg-black/20 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="text-sm font-medium text-gray-200">{insight.title || insight.insight_type}</div>
                        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">{insight.severity}</span>
                      </div>
                      <p className="mb-2 text-xs text-gray-400">{insight.cause || insight.message}</p>
                      {insight.fix_suggestions?.[0]?.description ? (
                        <div className="text-xs text-gray-300">
                          Fix: <span className="text-gray-400">{insight.fix_suggestions[0].description}</span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="mb-6 border-b border-gray-800">
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-all ${
                    isActive ? "border-blue-500 text-white" : "border-transparent text-gray-400 hover:border-gray-700 hover:text-gray-300"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  {tab.count !== null ? (
                    <span className={`rounded px-1.5 py-0.5 text-xs ${isActive ? "bg-blue-500/20 text-blue-400" : "bg-gray-800 text-gray-500"}`}>
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "timeline" ? (
          <RunTimelineView spans={orderedSpans} />
        ) : activeTab === "logs" ? (
          <div className="rounded-lg border border-gray-800 bg-[#0f0f1e]">
            <div className="border-b border-gray-800 px-4 py-3 text-sm font-medium text-gray-300">
              Logs ({logEntries.length})
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {logEntries.length === 0 ? (
                <div className="p-6 text-sm text-gray-400">No logs available.</div>
              ) : (
                <div className="divide-y divide-gray-800">
                  {logEntries.map((entry) => (
                    <div key={entry.id} className="px-4 py-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] uppercase ${
                            entry.level === "error"
                              ? "bg-red-500/20 text-red-300"
                              : entry.level === "warning"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-blue-500/20 text-blue-300"
                          }`}
                        >
                          {entry.level}
                        </span>
                        <span className="text-xs text-gray-500">{formatDateTime(entry.at)}</span>
                      </div>
                      <div className="mb-1 text-xs text-gray-500">{entry.source}</div>
                      <p className="text-sm text-gray-300">{entry.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "traces" ? (
          <div className="rounded-lg border border-gray-800 bg-[#0f0f1e]">
            <div className="border-b border-gray-800 px-4 py-3 text-sm font-medium text-gray-300">
              Traces ({orderedSpans.length})
            </div>
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-gray-800">
              {orderedSpans.length === 0 ? (
                <div className="p-6 text-sm text-gray-400">No traces available.</div>
              ) : (
                orderedSpans.map((span) => (
                  <div key={span.id} className="px-4 py-3">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-200">{span.tool_name ?? span.name ?? span.span_type}</div>
                      <div className="text-xs text-gray-500">{formatDurationMs(spanDurationMs(span))}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span className="rounded bg-gray-800 px-2 py-0.5">{span.span_type}</span>
                      <span className="rounded bg-gray-800 px-2 py-0.5">{span.status}</span>
                      {span.model ? <span className="rounded bg-gray-800 px-2 py-0.5">{span.model}</span> : null}
                      <span>{formatDateTime(span.started_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : activeTab === "performance" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-4">
                <div className="text-xs text-gray-500">Avg Span Latency</div>
                <div className="mt-1 text-2xl font-semibold text-white">{formatDurationMs(avgSpanLatencyMs)}</div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-4">
                <div className="text-xs text-gray-500">P95 Span Latency</div>
                <div className="mt-1 text-2xl font-semibold text-white">{formatDurationMs(p95SpanLatencyMs)}</div>
              </div>
              <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-4">
                <div className="text-xs text-gray-500">Slow Spans (≥3s)</div>
                <div className="mt-1 text-2xl font-semibold text-white">{slowSpanCount}</div>
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-[#0f0f1e]">
              <div className="border-b border-gray-800 px-4 py-3 text-sm font-medium text-gray-300">Span Breakdown</div>
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                      <th className="px-4 py-2">Span</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Duration</th>
                      <th className="px-4 py-2">Tokens</th>
                      <th className="px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800 text-sm text-gray-300">
                    {orderedSpans.map((span) => (
                      <tr key={span.id}>
                        <td className="px-4 py-2">{span.tool_name ?? span.name ?? span.span_type}</td>
                        <td className="px-4 py-2">{span.span_type}</td>
                        <td className="px-4 py-2">{formatDurationMs(spanDurationMs(span))}</td>
                        <td className="px-4 py-2">{(span.total_tokens ?? 0).toLocaleString()}</td>
                        <td className="px-4 py-2">${(span.estimated_cost ?? 0).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-6 text-sm text-gray-400">
            No data available.
          </div>
        )}
      </div>
    </div>
  );
}
