import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ArtifactViewer } from "@/components/artifact-viewer";
import { InsightsPanel } from "@/components/insights-panel";
import { PromptViewer } from "@/components/prompt-viewer";
import { RootCausePanel } from "@/components/root-cause-panel";
import { RunSummary } from "@/components/run-summary";
import { SpanDetail } from "@/components/span-detail";
import { SpanTree } from "@/components/span-tree";
import { TokenSummary } from "@/components/token-summary";
import {
  getRun,
  getRunAnalysis,
  getRunArtifacts,
  getRunInsights,
  getRunMetrics,
  getRunRootCause,
  getRunSpans,
} from "@/lib/server-api";

export const dynamic = "force-dynamic";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const [run, spans, insights, rootCause, metrics, artifacts, analysis] = await Promise.all([
    getRun(runId),
    getRunSpans(runId),
    getRunInsights(runId),
    getRunRootCause(runId),
    getRunMetrics(runId),
    getRunArtifacts(runId),
    getRunAnalysis(runId),
  ]);

  if (!run) {
    notFound();
  }

  return (
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div>
          <Link href="/runs" className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700">
            <ArrowLeft className="size-4" />
            Back to runs
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">{run.workflow_name}</h1>
          <div className="mt-2 text-sm text-neutral-500">{run.id}</div>
        </div>

        <RunSummary run={run} />
        <TokenSummary metrics={metrics} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <SpanTree spans={spans} />
          <div className="space-y-6">
            <SpanDetail spans={spans} />
            <PromptViewer artifacts={artifacts} />
            <ArtifactViewer artifacts={artifacts} />
            <RootCausePanel analysis={analysis} rootCause={rootCause} />
            <InsightsPanel insights={insights} />
          </div>
        </div>
      </section>
    </AppShell>
  );
}
