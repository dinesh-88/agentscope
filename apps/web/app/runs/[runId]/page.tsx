import Link from "next/link";
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
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div>
          <Link href="/runs" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Back to runs
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-100">{run.workflow_name}</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Total cost: ${(run.total_cost_usd ?? 0).toFixed(4)} · Total tokens:{" "}
            {(run.total_tokens ?? 0).toLocaleString()}
          </p>
        </div>
        <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} rootCause={rootCause} />
      </section>
    </AppShell>
  );
}
