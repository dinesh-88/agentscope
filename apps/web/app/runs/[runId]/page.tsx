import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { RunDetailView } from "@/components/run-detail-view";
import { getRun, getRunArtifacts, getRunInsights, getRunSpans } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const [run, spans, artifacts, insights] = await Promise.all([
    getRun(runId),
    getRunSpans(runId),
    getRunArtifacts(runId),
    getRunInsights(runId),
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
        </div>
        <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} />
      </section>
    </AppShell>
  );
}
