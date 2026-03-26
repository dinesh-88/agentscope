"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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

function isToolSpan(span: Span) {
  const value = `${span.span_type} ${span.name} ${span.tool_name ?? ""}`.toLowerCase();
  return value.includes("tool");
}

function isFailedSpan(span: Span) {
  const status = span.status.toLowerCase();
  return status === "failed" || status === "error";
}

function capitalize(value: string) {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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
  const failedStep = ordered.find((span) => isFailedSpan(span)) ?? ordered.at(-1) ?? null;
  const transitionStep =
    ordered.find((span) => (span.step_transition?.token_delta ?? 0) > 0 && span.step_transition?.tool_output_added) ??
    ordered.find((span) => span.step_transition?.tool_output_added) ??
    toolStep;

  const transitionDelta = transitionStep?.step_transition?.token_delta ?? 0;

  const runDuration = formatDuration(durationMs(run.started_at, run.ended_at));
  const runTokens = run.total_tokens ?? ordered.reduce((sum, span) => sum + (span.total_tokens ?? 0), 0);
  const runCost = run.total_cost_usd ?? 0;
  const runModel =
    failedStep?.model ??
    ordered
      .slice()
      .reverse()
      .find((span) => span.model && span.model.trim().length > 0)?.model ??
    "n/a";

  const statusLabel = run.status.toUpperCase();
  const title = run.workflow_name || run.agent_name || run.id;

  const summarySource =
    rootCause?.message ??
    insights.find((insight) => insight.is_primary)?.cause ??
    insights.find((insight) => insight.is_primary)?.message ??
    insights.find((insight) => insight.cause)?.cause ??
    insights.find((insight) => insight.message)?.message ??
    "Failure caused by invalid tool output injected into context";
  const summaryLine = summarySource.toLowerCase().startsWith("failure")
    ? `● ${summarySource}`
    : `● Failure caused by ${summarySource.charAt(0).toLowerCase()}${summarySource.slice(1)}`;

  const insightTitle = rootCause?.root_cause_type
    ? `Invalid ${rootCause.root_cause_type.replaceAll("_", " ")}`
    : insights.find((insight) => insight.title)?.title || "Invalid JSON from tool_call";
  const causeLine = rootCause?.message ?? insights.find((insight) => insight.cause)?.cause ?? "Tool output introduced invalid data";

  const fixesFromInsights = insights
    .flatMap((insight) => [
      ...insight.fix_suggestions.map((item) => item.description),
      ...insight.fix,
      insight.recommendation,
    ])
    .filter((value) => value && value.trim().length > 0);
  const fixOne = fixesFromInsights[0] ?? "Validate tool output";
  const fixTwo = fixesFromInsights[1] ?? "Add retry with schema enforcement";

  const llmDuration = llmStep ? formatDuration(durationMs(llmStep.started_at, llmStep.ended_at)) : "n/a";
  const toolDuration = toolStep ? formatDuration(durationMs(toolStep.started_at, toolStep.ended_at)) : "n/a";
  const failedDuration = failedStep ? formatDuration(durationMs(failedStep.started_at, failedStep.ended_at)) : "n/a";

  const toolTokens = toolStep?.total_tokens ?? Math.max(transitionDelta, 0);
  const failedTokens = failedStep?.total_tokens ?? 0;

  const llmLabel = llmStep?.name ?? "llm";
  const toolLabel = toolStep?.tool_name ?? toolStep?.name ?? "tool_call";
  const failedLabel = failedStep?.name ?? "llm_call";

  return (
    <section className="min-h-screen bg-[#0B0F1A] text-white">
      <div className="pointer-events-none absolute left-1/2 top-0 h-56 w-[38rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.16)_0%,rgba(124,58,237,0.05)_45%,transparent_75%)] blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-28 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.14)_0%,rgba(59,130,246,0.03)_45%,transparent_75%)] blur-3xl" />
      <div className="relative mx-auto max-w-5xl space-y-8 px-6 py-8">
        <header className="space-y-4 rounded-xl border border-white/10 bg-gradient-to-b from-[#111827]/80 to-[#0B1220]/80 p-6 shadow-[0_0_40px_rgba(124,58,237,0.08)] backdrop-blur-md">
          <Link href="/runs" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to runs
          </Link>

          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
            <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">{statusLabel}</span>
          </div>

          <p className="truncate text-base text-gray-200">◆ {summaryLine.replace(/^●\s*/, "")}</p>

          <div className="border-t border-white/10 pt-3 text-xs text-gray-500">{runDuration} • {runTokens.toLocaleString()} tokens • ${runCost.toFixed(4)} • {runModel}</div>
        </header>

        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{summaryLine}</div>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-[65fr_35fr]">
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-[#111827]/60 to-[#0B1220]/60 p-5 backdrop-blur-md">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-300">Execution Story</h2>
            <div className="relative space-y-4 pl-6">
              <div className="absolute bottom-0 left-2 top-0 w-px bg-white/10" />

            <div className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-blue-400" />
              <div>
                <p className="text-sm font-medium">LLM • {llmLabel}</p>
                <p className="text-xs text-gray-500">{llmDuration}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="mt-2 h-2 w-2 bg-yellow-400" />
              <div>
                <p className="text-sm font-medium">Tool • {toolLabel}</p>
                <p className="text-xs text-gray-500">
                  {toolDuration} • +{Math.max(toolTokens, 0).toLocaleString()} tokens
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
              <div className="flex gap-3">
                <span className="mt-1 text-yellow-400">⚠</span>
                <div>
                  <p className="text-sm text-yellow-300">Tool output injected</p>
                  <p className="text-xs text-gray-500">+ Context grew (+{Math.max(transitionDelta, toolTokens, 0).toLocaleString()} tokens)</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <div className="flex gap-3">
                <span className="mt-2 h-2 w-2 rounded-full bg-red-500" />
                <div>
                  <p className="text-sm font-semibold text-red-400">FAILED STEP</p>
                  <p className="text-sm font-medium">LLM • {failedLabel}</p>
                  <p className="text-xs text-gray-500">
                    {failedDuration} • {failedTokens.toLocaleString()} tokens
                  </p>
                </div>
              </div>
            </div>
            </div>
          </div>

          <div className="sticky top-6 h-fit space-y-4 rounded-xl border border-white/10 bg-gradient-to-b from-[#111827]/80 to-[#0B1220]/80 p-5 shadow-[0_0_30px_rgba(239,68,68,0.08)] backdrop-blur-md">
            <p className="font-semibold text-red-300">⚠ {capitalize(insightTitle)}</p>

            <div>
              <p className="text-xs uppercase text-gray-400">Cause</p>
              <p className="text-sm text-gray-200">{causeLine}</p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-400">Fix</p>
              <p className="text-sm text-gray-200">• {fixOne}</p>
              <p className="text-sm text-gray-200">• {fixTwo}</p>
            </div>

            <div className="border-t border-white/10 pt-3">
              <p className="text-xs text-gray-500">Context (collapsed)</p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
