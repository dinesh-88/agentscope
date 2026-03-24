import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, Clock, DollarSign, Zap } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { RunDetailView } from "@/components/run-detail-view";
import { getRun, getRunArtifacts, getRunInsights, getRunRootCause, getRunSpans } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const [run, spans, artifacts, insights, rootCause] = await Promise.all([
    getRun(runId),
    getRunSpans(runId),
    getRunArtifacts(runId),
    getRunInsights(runId),
    getRunRootCause(runId),
  ]);

  if (!run) {
    notFound();
  }

  const runDurationMs = run.ended_at
    ? Math.max(0, new Date(run.ended_at).getTime() - new Date(run.started_at).getTime())
    : null;
  const runDurationLabel =
    runDurationMs === null ? "running" : runDurationMs < 1000 ? `${Math.round(runDurationMs)}ms` : `${(runDurationMs / 1000).toFixed(1)}s`;
  const statusTone =
    run.status === "failed" || run.status === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300"
      : run.status === "running"
        ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300";
  const latestModel =
    spans
      .slice()
      .reverse()
      .find((span) => typeof span.model === "string" && span.model.length > 0)?.model ?? "n/a";
  const hasFailedSpan = spans.some((span) => span.status === "failed" || span.status === "error");
  const highlightInsight =
    insights.find((insight) => insight.severity === "high") ??
    insights.find((insight) => insight.severity === "medium") ??
    insights[0] ??
    null;
  const runSummary =
    insights.find((insight) => insight.insight_type === "RUN_SUMMARY" && insight.is_primary) ??
    insights.find((insight) => insight.insight_type === "RUN_SUMMARY") ??
    null;
  const summaryMessage =
    runSummary?.message ??
    rootCause?.message ??
    highlightInsight?.message ??
    (hasFailedSpan ? "Run failed with unknown cause in execution pipeline" : "Run completed successfully in orchestrator");
  const summaryTone =
    run.status === "failed" || run.status === "error"
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200"
      : runSummary?.severity === "high" || runSummary?.severity === "medium"
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200"
        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200";

  return (
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div className="space-y-4">
          <Link href="/runs" className="inline-flex text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200">
            Back to runs
          </Link>

          <div className="space-y-3 rounded-xl border border-black/8 bg-white/90 p-4 shadow-sm dark:border-white/10 dark:bg-slate-900/80">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-100">{run.workflow_name}</h1>
              <span className={`inline-flex rounded-lg border px-3 py-1 text-sm font-medium uppercase ${statusTone}`}>
                {run.status}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-neutral-700 dark:bg-slate-800 dark:text-neutral-300">
                <Clock className="size-3.5" />
                {runDurationLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-neutral-700 dark:bg-slate-800 dark:text-neutral-300">
                <BarChart3 className="size-3.5" />
                {(run.total_tokens ?? 0).toLocaleString()} tokens
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-neutral-700 dark:bg-slate-800 dark:text-neutral-300">
                <DollarSign className="size-3.5" />
                ${(run.total_cost_usd ?? 0).toFixed(4)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-1 text-neutral-700 dark:bg-slate-800 dark:text-neutral-300">
                <Zap className="size-3.5" />
                {latestModel}
              </span>
            </div>

            <a href="#insights-panel" className={`block rounded-lg border-l-4 p-3 ${summaryTone}`}>
              <p className="text-xs font-semibold uppercase tracking-wide">
                Run Summary
              </p>
              <p className="mt-1 text-sm font-medium">
                {summaryMessage}
              </p>
              <p className="mt-1 text-xs opacity-80">View details in insights</p>
            </a>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Run ID: {run.id}</p>
        </div>
        <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} rootCause={rootCause} />
      </section>
    </AppShell>
  );
}
