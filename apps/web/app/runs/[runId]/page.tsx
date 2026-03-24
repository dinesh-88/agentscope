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
      ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
      : run.status === "running"
        ? "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
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
  const criticalSummary =
    rootCause?.message ??
    highlightInsight?.message ??
    (hasFailedSpan ? "Run failed due to an error in a downstream span." : "No critical failures detected.");

  return (
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div className="space-y-4">
          <Link href="/runs" className="inline-flex text-sm font-medium text-blue-600 hover:text-blue-700">
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

            <div className={hasFailedSpan ? "rounded-lg border border-red-300 bg-red-50 p-3" : "rounded-lg border border-emerald-300 bg-emerald-50 p-3"}>
              <p className={hasFailedSpan ? "text-xs font-semibold uppercase tracking-wide text-red-700" : "text-xs font-semibold uppercase tracking-wide text-emerald-700"}>
                Critical
              </p>
              <p className={hasFailedSpan ? "mt-1 text-sm font-medium text-red-700" : "mt-1 text-sm font-medium text-emerald-700"}>
                {criticalSummary}
              </p>
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Run ID: {run.id}</p>
        </div>
        <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} rootCause={rootCause} />
      </section>
    </AppShell>
  );
}
