"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Search,
  Download,
  Filter,
  Clock,
  Zap,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  FileText,
  GitBranch,
} from "lucide-react";
import { useMemo, useState } from "react";

import { RunExecutionChart } from "@/components/run-execution-chart";
import { RunExecutionFlow } from "@/components/run-execution-flow";
import { RunInsightPanel } from "@/components/run-insight-panel";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : start;
  return Math.max(0, end - start);
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms > 10_000 ? 0 : 1)}s`;
}

function formatDurationSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function isToolSpan(span: Span) {
  const value = `${span.span_type} ${span.name} ${span.tool_name ?? ""}`.toLowerCase();
  return value.includes("tool");
}

function isFailedSpan(span: Span) {
  const status = span.status.toLowerCase();
  return status === "failed" || status === "error";
}

type Tab = "timeline" | "logs" | "traces" | "performance";

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
  void artifacts;

  const [activeTab, setActiveTab] = useState<Tab>("timeline");

  const ordered = useMemo(
    () => [...spans].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
    [spans]
  );

  const llmStep = ordered.find((span) => !isToolSpan(span)) ?? ordered[0] ?? null;
  const toolStep = ordered.find((span) => isToolSpan(span)) ?? null;
  const failedStep = ordered.find((span) => isFailedSpan(span)) ?? null;
  const terminalStep = failedStep ?? ordered.at(-1) ?? null;
  const transitionStep =
    ordered.find((span) => (span.step_transition?.token_delta ?? 0) > 0 && span.step_transition?.tool_output_added) ??
    ordered.find((span) => span.step_transition?.tool_output_added) ??
    toolStep;

  const runDurationMs = durationMs(run.started_at, run.ended_at);
  const runDuration = formatDuration(runDurationMs);
  const runTokens = run.total_tokens ?? ordered.reduce((sum, span) => sum + (span.total_tokens ?? 0), 0);
  const runCost = run.total_cost_usd ?? 0;
  const runModel =
    terminalStep?.model ??
    ordered
      .slice()
      .reverse()
      .find((span) => span.model && span.model.trim().length > 0)?.model ??
    "gpt-4.1-mini";

  const title = run.workflow_name || run.agent_name || run.id;
  const isFailure = run.status === "failed" || run.status === "error" || Boolean(failedStep);

  const insightTitle =
    isFailure && rootCause?.root_cause_type
      ? `Invalid ${rootCause.root_cause_type.replaceAll("_", " ")}`
      : insights.find((insight) => insight.title)?.title || (isFailure ? "Run failure detected" : "Execution completed");
  const causeLine =
    rootCause?.message ??
    insights.find((insight) => insight.cause)?.cause ??
    insights.find((insight) => insight.message)?.message ??
    (isFailure ? "Tool output introduced invalid data into context" : "Run completed without critical failures");

  const fixes = insights
    .flatMap((insight) => [...insight.fix_suggestions.map((item) => item.description), ...insight.fix, insight.recommendation])
    .filter((value) => value && value.trim().length > 0);
  const fixOne = fixes[0] ?? "Validate tool output before injection";
  const fixTwo = fixes[1] ?? "Add retry with schema enforcement";

  const toolTokens = toolStep?.total_tokens ?? 0;
  const transitionDelta = Math.max(transitionStep?.step_transition?.token_delta ?? 0, toolTokens, 0);
  const contextTokens = ordered.reduce((sum, span) => sum + (span.context_tokens ?? 0), 0) || runTokens;

  const summaryLine = isFailure
    ? `Failure caused by ${causeLine.charAt(0).toLowerCase()}${causeLine.slice(1)}`
    : `Execution completed: ${causeLine}`;

  const baseStartMs = new Date(run.started_at).getTime();
  const chartData = [
    { time: 0, latency: 0, llm: 0, tool: null, failed: null },
    ...ordered.map((span) => {
      const spanStart = new Date(span.started_at).getTime();
      const spanEnd = span.ended_at
        ? new Date(span.ended_at).getTime()
        : run.ended_at
          ? new Date(run.ended_at).getTime()
          : spanStart;
      const elapsed = Math.max(0, spanStart - baseStartMs) / 1000;
      const latency = Math.max(0, spanEnd - spanStart) / 1000;
      const tool = isToolSpan(span);
      const failed = isFailedSpan(span);

      return {
        time: Number(elapsed.toFixed(2)),
        latency: Number(latency.toFixed(2)),
        llm: !tool ? Number(latency.toFixed(2)) : null,
        tool: tool ? Number(latency.toFixed(2)) : null,
        failed: failed ? Number(latency.toFixed(2)) : null,
      };
    }),
  ];

  const eventMarkerFromSpan = (
    span: Span | null,
    markerTitle: string,
    value: string,
    tone: "blue" | "amber" | "red"
  ) => {
    if (!span) return undefined;
    const x = Math.max(0, new Date(span.started_at).getTime() - baseStartMs) / 1000;
    return {
      x: Number(x.toFixed(2)),
      title: markerTitle,
      subtitle: span.tool_name ?? span.name,
      value,
      tone,
    };
  };

  const llmMarker = eventMarkerFromSpan(
    llmStep,
    "LLM Call",
    llmStep ? formatDurationSeconds(durationMs(llmStep.started_at, llmStep.ended_at)) : "n/a",
    "blue"
  );
  const toolMarker = eventMarkerFromSpan(
    toolStep,
    "Tool Call",
    `+${Math.max(toolTokens, 0).toLocaleString()} tokens`,
    "amber"
  );
  const failedMarker = eventMarkerFromSpan(
    terminalStep,
    isFailure ? "FAILED" : "COMPLETED",
    terminalStep ? formatDurationSeconds(durationMs(terminalStep.started_at, terminalStep.ended_at)) : "n/a",
    "red"
  );

  const tabs: Array<{ id: Tab; label: string; icon: typeof Activity; count: number | null }> = [
    { id: "timeline", label: "Timeline", icon: Activity, count: null },
    { id: "logs", label: "Logs", icon: FileText, count: ordered.length },
    { id: "traces", label: "Traces", icon: GitBranch, count: ordered.length },
    { id: "performance", label: "Performance", icon: TrendingUp, count: null },
  ];

  const metricCards = [
    {
      label: "Avg Latency",
      value: ordered.length > 0 ? formatDuration(runDurationMs / ordered.length) : runDuration,
      subtext: `${ordered.length} steps`,
      icon: Clock,
      trend: isFailure ? "up" : "neutral",
      status: isFailure ? "warning" : "normal",
    },
    {
      label: "Total Tokens",
      value: runTokens.toLocaleString(),
      subtext: `Context ${contextTokens.toLocaleString()}`,
      icon: Zap,
      trend: "neutral",
      status: "normal",
    },
    {
      label: "Total Cost",
      value: `$${runCost.toFixed(4)}`,
      subtext: runModel,
      icon: DollarSign,
      trend: "neutral",
      status: "normal",
    },
    {
      label: "Steps Executed",
      value: `${ordered.length}`,
      subtext: isFailure ? "Run ended with failure" : "Run completed",
      icon: AlertTriangle,
      trend: isFailure ? "down" : "neutral",
      status: isFailure ? "error" : "normal",
    },
  ] as const;

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      <div className="sticky top-0 z-50 border-b border-gray-800 bg-[#0a0a14]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-[1800px] px-6 py-4">
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
              <div>
                <div className="mb-2 flex items-center gap-3">
                  <h1 className="text-2xl font-semibold">{title}</h1>
                  <span
                    className={
                      isFailure
                        ? "flex items-center gap-1.5 rounded border border-red-500/50 bg-red-950/50 px-2.5 py-1 text-xs font-medium text-red-400"
                        : "flex items-center gap-1.5 rounded border border-emerald-500/50 bg-emerald-950/50 px-2.5 py-1 text-xs font-medium text-emerald-400"
                    }
                  >
                    <span
                      className={
                        isFailure
                          ? "h-1.5 w-1.5 animate-pulse rounded-full bg-red-500"
                          : "h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
                      }
                    />
                    {run.status.toUpperCase()}
                  </span>
                  <span className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-400">{run.id}</span>
                </div>
                <p className="text-sm text-gray-400">Model: <span className="text-gray-300">{runModel}</span></p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="mb-1 text-xs text-gray-500">Total Duration</div>
                  <div className="text-lg font-semibold text-white">{runDuration}</div>
                </div>
                <div className="text-right">
                  <div className="mb-1 text-xs text-gray-500">Total Cost</div>
                  <div className="text-lg font-semibold text-white">${runCost.toFixed(4)}</div>
                </div>
                <div className="text-right">
                  <div className="mb-1 text-xs text-gray-500">Tokens Used</div>
                  <div className="text-lg font-semibold text-white">{runTokens.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div
              className={
                isFailure
                  ? "rounded-r-lg border-l-4 border-red-500 bg-gradient-to-r from-red-950/50 to-red-900/30 p-4"
                  : "rounded-r-lg border-l-4 border-emerald-500 bg-gradient-to-r from-emerald-950/50 to-emerald-900/30 p-4"
              }
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className={isFailure ? "mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" : "mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500"} />
                <div className="flex-1">
                  <div className={isFailure ? "mb-1 font-medium text-red-400" : "mb-1 font-medium text-emerald-400"}>{insightTitle}</div>
                  <p className="text-sm text-gray-300">{summaryLine}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1800px] px-6 py-6">
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {metricCards.map((metric) => {
            const Icon = metric.icon;
            const TrendIcon = metric.trend === "up" ? TrendingUp : metric.trend === "down" ? TrendingDown : null;

            return (
              <div
                key={metric.label}
                className={`rounded-lg border bg-gradient-to-br from-gray-900 to-gray-900/50 p-4 ${
                  metric.status === "warning"
                    ? "border-amber-900/50"
                    : metric.status === "error"
                      ? "border-red-900/50"
                      : "border-gray-800"
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div
                    className={`rounded-lg p-2 ${
                      metric.status === "warning"
                        ? "bg-amber-500/10"
                        : metric.status === "error"
                          ? "bg-red-500/10"
                          : "bg-gray-800"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${
                        metric.status === "warning"
                          ? "text-amber-500"
                          : metric.status === "error"
                            ? "text-red-500"
                            : "text-gray-400"
                      }`}
                    />
                  </div>
                  {TrendIcon ? (
                    <TrendIcon className={`h-4 w-4 ${metric.trend === "up" ? "text-amber-500" : "text-red-500"}`} />
                  ) : null}
                </div>
                <div className="mb-1 text-xs text-gray-500">{metric.label}</div>
                <div className="mb-1 text-2xl font-semibold text-white">{metric.value}</div>
                <div className="text-xs text-gray-400">{metric.subtext}</div>
              </div>
            );
          })}
        </div>

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
                    isActive
                      ? "border-blue-500 text-white"
                      : "border-transparent text-gray-400 hover:border-gray-700 hover:text-gray-300"
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr,400px]">
          <div className="space-y-6">
            {activeTab === "timeline" ? (
              <>
                <RunExecutionChart
                  data={chartData}
                  llmMarker={llmMarker}
                  toolMarker={toolMarker}
                  failedMarker={failedMarker}
                  llmLegend={llmStep?.name ?? "router"}
                  toolLegend={toolStep?.tool_name ?? toolStep?.name ?? "tool_call"}
                  failureLegend={terminalStep?.name ?? "final_step"}
                  contextDeltaLabel={`+${transitionDelta.toLocaleString()} tokens`}
                  outcomeLabel={isFailure ? "Failure" : "Outcome"}
                />
                <RunExecutionFlow
                  llmLabel={llmStep?.name ?? "router"}
                  toolLabel={toolStep?.tool_name ?? toolStep?.name ?? "get_order_status"}
                  failedLabel={terminalStep?.name ?? "final_step"}
                  llmDuration={llmStep ? formatDuration(durationMs(llmStep.started_at, llmStep.ended_at)) : "n/a"}
                  toolDuration={toolStep ? formatDuration(durationMs(toolStep.started_at, toolStep.ended_at)) : "n/a"}
                  failedDuration={terminalStep ? formatDuration(durationMs(terminalStep.started_at, terminalStep.ended_at)) : "n/a"}
                  toolTokens={toolTokens}
                  contextNote={causeLine}
                  failedState={isFailure ? "Step failed" : "Completed"}
                  isFailure={isFailure}
                />
              </>
            ) : (
              <div className="rounded-lg border border-gray-800 bg-[#0f0f1e] p-8 text-sm text-gray-400">
                {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} view is coming next.
              </div>
            )}
          </div>

          <RunInsightPanel
            insightTitle={insightTitle}
            causeLine={causeLine}
            fixOne={fixOne}
            fixTwo={fixTwo}
            contextTokens={contextTokens}
          />
        </div>
      </div>
    </div>
  );
}
