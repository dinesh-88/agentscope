"use client";

import { Activity, ArrowLeft, FileText, GitBranch, Loader2, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { RunTimelineView } from "@/components/run-timeline-view";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";
import { useRunStream } from "@/lib/use-run-stream";

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

function isRunningStatus(status: string) {
  const value = status.toLowerCase();
  return value === "running" || value === "pending";
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

function severityForSpan(span: Span): "error" | "warning" | "info" {
  const status = span.status.toLowerCase();
  if (status === "failed" || status === "error" || span.success === false) return "error";
  if (status === "warning") return "warning";
  return "info";
}

function insightType(insight: RunInsight) {
  return (insight.insight_type || insight.type || "").toUpperCase();
}

function insightSeverityRank(severity: string) {
  const normalized = severity.toLowerCase();
  if (normalized === "high") return 0;
  if (normalized === "medium") return 1;
  if (normalized === "low") return 2;
  return 3;
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
  useRunStream({
    runId: run.id,
    initialRun: run,
    initialSpans: spans,
    initialArtifacts: artifacts,
  });
  const liveRun = useRunDetailStore((state) => state.run);
  const liveSpans = useRunDetailStore((state) => state.spans);
  const liveArtifacts = useRunDetailStore((state) => state.artifacts);

  const currentRun = liveRun ?? run;
  const currentSpans = liveSpans.length > 0 ? liveSpans : spans;
  const currentArtifacts = liveArtifacts.length > 0 ? liveArtifacts : artifacts;
  const orderedSpans = useMemo(
    () => [...currentSpans].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at)),
    [currentSpans],
  );
  const runStatusIsFailure = isFailureStatus(currentRun.status) || currentRun.success === false;
  const runStatusIsRunning = isRunningStatus(currentRun.status);
  const [activeTab, setActiveTab] = useState<"timeline" | "logs" | "traces" | "performance">("timeline");
  const totalTokens = currentRun.total_tokens ?? orderedSpans.reduce((acc, span) => acc + (span.total_tokens ?? 0), 0);
  const totalCost = currentRun.total_cost_usd ?? orderedSpans.reduce((acc, span) => acc + (span.estimated_cost ?? 0), 0);
  const runMs = runDurationMs(currentRun);
  const primaryInsight = useMemo(
    () => insights.find((item) => insightType(item) === "RUN_FAILURE") || insights[0] || null,
    [insights],
  );
  const failureSummary = runStatusIsFailure
    ? (primaryInsight?.reason?.trim() || primaryInsight?.message?.trim() || "Run failed. Root cause not yet analyzed.")
    : "Execution completed without critical failure";
  const insightCards = useMemo(
    () =>
      [...insights]
        .sort((left, right) => insightSeverityRank(left.severity || "") - insightSeverityRank(right.severity || ""))
        .slice(0, 2),
    [insights],
  );
  const hasRca = Boolean(rootCause);
  const rootCauseLabel = rootCause?.root_cause_type || "Unavailable";
  const rootCauseConfidence = typeof rootCause?.confidence === "number" ? `${Math.round(rootCause.confidence * 100)}% confidence` : null;
  const rootCauseMessage = rootCause?.message || "Run failed. Root cause not yet analyzed.";
  const rootCauseFix = rootCause?.suggested_fix || null;
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
    const artifactLogs = currentArtifacts.map((artifact) => {
      const span = artifact.span_id ? spansById.get(artifact.span_id) : undefined;
      return {
        id: `artifact-${artifact.id}`,
        at: span?.started_at ?? currentRun.started_at,
        level: "info" as const,
        source: artifact.kind,
        message: readPayloadText(artifact.payload ?? {}),
      };
    });
    return [...spanLogs, ...artifactLogs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [orderedSpans, currentArtifacts, spansById, currentRun.started_at]);
  const tabs = [
    { id: "timeline" as const, label: "Timeline", icon: Activity, count: null },
    { id: "logs" as const, label: "Logs", icon: FileText, count: logEntries.length },
    { id: "traces" as const, label: "Traces", icon: GitBranch, count: orderedSpans.length },
    { id: "performance" as const, label: "Performance", icon: TrendingUp, count: slowSpanCount },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      <div className="border-b border-white/5 px-6 py-5">
        <div className="mb-4">
          <Link href="/runs" className="inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-300">
            <ArrowLeft className="h-4 w-4" />
            <span>Back to runs</span>
          </Link>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{currentRun.workflow_name || currentRun.agent_name || currentRun.id}</h1>
          <span
            className={`rounded border px-2.5 py-1 text-xs font-medium ${
              runStatusIsFailure
                ? "border-red-500/50 bg-red-500/10 text-red-300"
                : runStatusIsRunning
                  ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              {runStatusIsRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span>{currentRun.status.toUpperCase()}</span>
            </span>
          </span>
        </div>

        <p className={`mb-3 text-sm ${runStatusIsFailure ? "text-red-300" : "text-gray-300"}`}>{failureSummary}</p>

        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
          <span>Duration: {formatDurationMs(runMs)}</span>
          <span>Tokens: {totalTokens.toLocaleString()}</span>
          <span>Cost: ${totalCost.toFixed(4)}</span>
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        <div className="border-b border-white/5">
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
          <div className="rounded-lg border border-white/5 bg-white/[0.02]">
            <div className="border-b border-white/5 px-4 py-3 text-sm font-medium text-gray-300">Logs ({logEntries.length})</div>
            <div className="max-h-[70vh] overflow-y-auto">
              {logEntries.length === 0 ? (
                <div className="p-6 text-sm text-gray-400">No logs available.</div>
              ) : (
                <div className="divide-y divide-white/5">
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
          <div className="rounded-lg border border-white/5 bg-white/[0.02]">
            <div className="border-b border-white/5 px-4 py-3 text-sm font-medium text-gray-300">Traces ({orderedSpans.length})</div>
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/5">
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
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
                <div className="text-xs text-gray-500">Avg Span Latency</div>
                <div className="mt-1 text-2xl font-semibold text-white">{formatDurationMs(avgSpanLatencyMs)}</div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
                <div className="text-xs text-gray-500">P95 Span Latency</div>
                <div className="mt-1 text-2xl font-semibold text-white">{formatDurationMs(p95SpanLatencyMs)}</div>
              </div>
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
                <div className="text-xs text-gray-500">Slow Spans (≥3s)</div>
                <div className="mt-1 text-2xl font-semibold text-white">{slowSpanCount}</div>
              </div>
            </div>

            <div className="rounded-lg border border-white/5 bg-white/[0.02]">
              <div className="border-b border-white/5 px-4 py-3 text-sm font-medium text-gray-300">Span Breakdown</div>
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-xs text-gray-500">
                      <th className="px-4 py-2">Span</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Duration</th>
                      <th className="px-4 py-2">Tokens</th>
                      <th className="px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-sm text-gray-300">
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
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {hasRca ? (
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-gray-100">Root Cause Analysis</div>
                {rootCauseConfidence ? (
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase text-gray-200">{rootCauseConfidence}</span>
                ) : null}
              </div>
              <p className="mb-2 text-sm font-medium text-gray-200">{rootCauseLabel}</p>
              <p className="mb-3 text-sm text-gray-300">{rootCauseMessage}</p>
              {rootCauseFix ? (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Fix</div>
                  <p className="text-xs text-gray-300">{rootCauseFix}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {insightCards.length > 0 ? (
            insightCards.map((insight) => (
              <div key={insight.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-gray-100">{insight.title || insight.insight_type || insight.type || "Insight"}</div>
                  <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase text-gray-200">
                    {insight.severity || "high"}
                  </span>
                </div>
                <p className="mb-3 text-sm text-gray-300">{insight.reason || insight.message || "Run failed. Root cause not yet analyzed."}</p>
                {insight.cause ? (
                  <div className="mb-3">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Cause</div>
                    <p className="text-xs text-gray-300">{insight.cause}</p>
                  </div>
                ) : null}
                {Array.isArray(insight.fix) && insight.fix.length > 0 ? (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Fix</div>
                    <ul className="space-y-1">
                      {insight.fix.map((item, index) => (
                        <li key={`${insight.id}-fix-${index}`} className="flex items-start gap-2 text-xs text-gray-300">
                          <span className="text-gray-500">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-2 text-sm font-semibold text-gray-100">Insights</div>
              <p className="mb-3 text-sm text-gray-300">Run failed. Root cause not yet analyzed.</p>
              <button
                type="button"
                className="rounded border border-white/20 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10"
              >
                Generate insights
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
