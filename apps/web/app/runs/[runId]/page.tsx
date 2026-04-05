import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { RunDetailView } from "@/components/run-detail-view";
import { getRun, getRunArtifacts, getRunInsights, getRunRootCause, getRunSpans, getRunsFiltered } from "@/lib/server-api";

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

  const traceId =
    run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
      ? (run.metadata as Record<string, unknown>).trace_id
      : null;

  const relatedRuns =
    typeof traceId === "string" && traceId.trim().length > 0
      ? await getRunsFiltered({ trace_id: traceId })
      : [];

  return (
    <AppShell activePath="/runs" theme="dark" mainClassName="px-0 pb-0">
      <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} rootCause={rootCause} relatedRuns={relatedRuns} />
    </AppShell>
  );
}
