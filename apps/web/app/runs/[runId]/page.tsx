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

  return (
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div className="space-y-4">
          <Link href="/runs" className="inline-flex text-sm font-medium text-blue-600 hover:text-blue-700">
            Back to runs
          </Link>

          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-100">{run.workflow_name}</h1>
            <span className={`inline-flex rounded-lg border px-3 py-1 text-sm font-medium capitalize ${statusTone}`}>
              {run.status}
            </span>
          </div>

          <p className="text-sm text-neutral-600 dark:text-neutral-400">Run ID: {run.id}</p>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-black/5 bg-white/90 p-4 shadow-sm sm:grid-cols-4 dark:border-white/10 dark:bg-slate-900/80">
            <div className="text-center">
              <div className="mb-1 flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                <Clock className="size-3.5" />
                Duration
              </div>
              <p className="text-sm font-semibold text-neutral-950 dark:text-neutral-100">{runDurationLabel}</p>
            </div>
            <div className="text-center">
              <div className="mb-1 flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                <DollarSign className="size-3.5" />
                Cost
              </div>
              <p className="text-sm font-semibold text-neutral-950 dark:text-neutral-100">${(run.total_cost_usd ?? 0).toFixed(4)}</p>
            </div>
            <div className="text-center">
              <div className="mb-1 flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                <BarChart3 className="size-3.5" />
                Tokens
              </div>
              <p className="text-sm font-semibold text-neutral-950 dark:text-neutral-100">{(run.total_tokens ?? 0).toLocaleString()}</p>
            </div>
            <div className="text-center">
              <div className="mb-1 flex items-center justify-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
                <Zap className="size-3.5" />
                Model
              </div>
              <p className="truncate text-sm font-semibold text-neutral-950 dark:text-neutral-100">{latestModel}</p>
            </div>
          </div>

          {hasFailedSpan && highlightInsight ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">{highlightInsight.message}</p>
              <p className="mt-1 text-xs text-red-700/90 dark:text-red-300/90">{highlightInsight.recommendation}</p>
            </div>
          ) : null}
        </div>
        <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} rootCause={rootCause} />
      </section>
    </AppShell>
  );
}
