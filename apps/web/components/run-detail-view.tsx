"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { RunExecutionChart } from "@/components/run-execution-chart";
import { RunExecutionFlow } from "@/components/run-execution-flow";
import { RunInsightPanel } from "@/components/run-insight-panel";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
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

  const ordered = [...spans].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  const llmStep = ordered.find((span) => !isToolSpan(span)) ?? ordered[0] ?? null;
  const toolStep = ordered.find((span) => isToolSpan(span)) ?? null;
  const failedStep = ordered.find((span) => isFailedSpan(span)) ?? null;
  const terminalStep = failedStep ?? ordered.at(-1) ?? null;
  const transitionStep =
    ordered.find((span) => (span.step_transition?.token_delta ?? 0) > 0 && span.step_transition?.tool_output_added) ??
    ordered.find((span) => span.step_transition?.tool_output_added) ??
    toolStep;

  const runDuration = formatDuration(durationMs(run.started_at, run.ended_at));
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

  const statusClass =
    run.status === "failed" || run.status === "error"
      ? "bg-red-950/50 border border-red-500/50 text-red-400"
      : run.status === "running"
        ? "bg-blue-950/40 border border-blue-500/40 text-blue-400"
        : "bg-emerald-950/40 border border-emerald-500/40 text-emerald-400";

  const statusLabel = run.status.toUpperCase();
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
    title: string,
    value: string,
    tone: "blue" | "amber" | "red"
  ) => {
    if (!span) return undefined;
    const x = Math.max(0, new Date(span.started_at).getTime() - baseStartMs) / 1000;
    return {
      x: Number(x.toFixed(2)),
      title,
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
    isFailure ? "red" : "blue"
  );

  return (
    <div className="min-h-screen bg-[#0a0a14] text-white">
      <div className="mx-auto max-w-[1600px] p-8">
        <Link href="/runs" className="mb-6 inline-flex items-center gap-2 text-gray-400 transition-colors hover:text-gray-300">
          <ArrowLeft className="h-4 w-4" />
          <span className="text-sm">Back to runs</span>
        </Link>

        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="truncate text-3xl">{title}</h1>
              <span className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs ${statusClass}`}>
                <span>{run.status === "failed" || run.status === "error" ? "✕" : "•"}</span>
                {statusLabel}
              </span>
            </div>

            <div
              className={
                isFailure
                  ? "min-w-[280px] rounded-lg border border-red-900/50 bg-gradient-to-br from-red-950/40 to-purple-950/30 px-4 py-3"
                  : "min-w-[280px] rounded-lg border border-emerald-900/50 bg-gradient-to-br from-emerald-950/40 to-slate-950/30 px-4 py-3"
              }
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 h-5 w-5">
                  <svg viewBox="0 0 20 20" fill="none" className="h-full w-full">
                    <path
                      d="M10 2L3 18h14L10 2z"
                      fill="currentColor"
                      className={isFailure ? "text-red-500" : "text-emerald-500"}
                    />
                  </svg>
                </div>
                <div>
                  <div className={isFailure ? "mb-0.5 text-sm font-medium text-red-400" : "mb-0.5 text-sm font-medium text-emerald-400"}>
                    Primary Insight
                  </div>
                  <div className="text-sm text-gray-300">{causeLine}</div>
                </div>
              </div>
            </div>
          </div>

          <div className={isFailure ? "mb-3 flex items-center gap-2 text-sm text-red-400" : "mb-3 flex items-center gap-2 text-sm text-emerald-400"}>
            <div className={isFailure ? "h-1.5 w-1.5 rounded-full bg-red-500" : "h-1.5 w-1.5 rounded-full bg-emerald-500"} />
            <span>{summaryLine}</span>
          </div>

          <div className="flex items-center gap-3 text-sm text-gray-400">
            <div className="flex items-center gap-1.5">
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 4v4l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span>{runDuration}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M2 6h12M6 2v12" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              <span>{runTokens.toLocaleString()} tokens</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>$</span>
              <span>${runCost.toFixed(4)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <circle cx="8" cy="8" r="2" fill="currentColor" />
              </svg>
              <span>{runModel}</span>
            </div>
          </div>
        </div>

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

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr,380px]">
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
