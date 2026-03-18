import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock3 } from "lucide-react";

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
      <section className="space-y-2 p-4 sm:p-6">
        <Link href="/runs" className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-800">
          <ArrowLeft className="size-4" />
          Back to runs
        </Link>

        <div className="rounded-2xl border border-black/5 bg-white/80 p-4 shadow-sm">
          <h1 className="text-xl font-semibold text-neutral-900">{run.workflow_name}</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-neutral-600">
            <span>{run.agent_name}</span>
            <span>•</span>
            <span className="capitalize">{run.status}</span>
            <span>•</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-4" />
              {new Date(run.started_at).toLocaleString()}
            </span>
          </div>
        </div>
      </section>

      <RunDetailView run={run} spans={spans} artifacts={artifacts} insights={insights} />
    </AppShell>
  );
}
