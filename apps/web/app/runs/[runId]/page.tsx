import { notFound } from "next/navigation";

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

  return (
    <AppShell activePath="/runs" theme="dark" mainClassName="px-0 pb-0">
      <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} rootCause={rootCause} />
    </AppShell>
  );
}
