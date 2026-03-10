import type { ComponentType } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Coins, FileSearch2, Timer } from "lucide-react";

import { InsightsPanel } from "@/components/insights-panel";
import { PromptViewer } from "@/components/prompt-viewer";
import { RcaPanel } from "@/components/rca-panel";
import { Sidebar } from "@/components/sidebar";
import { SpanTree } from "@/components/span-tree";
import { Button } from "@/components/ui/button";
import { getRun, getRunArtifacts, getRunInsights, getRunMetrics, getRunRootCause, getRunSpans } from "@/lib/api";

export const dynamic = "force-dynamic";

type RunDetailPageProps = {
  params: Promise<{ runId: string }>;
};

function formatDate(value: string | null) {
  if (!value) return "In progress";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { runId } = await params;
  const [run, spans, insights, rootCause, metrics, artifacts] = await Promise.all([
    getRun(runId),
    getRunSpans(runId),
    getRunInsights(runId),
    getRunRootCause(runId),
    getRunMetrics(runId),
    getRunArtifacts(runId),
  ]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(20,184,166,0.12),_transparent_26%),linear-gradient(180deg,#f6fbfb_0%,#ecf1f6_100%)] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Sidebar activePath="/runs" />

        <section className="space-y-6">
          <div className="rounded-[32px] border border-white/70 bg-white/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <Button
                  render={<Link href="/runs" />}
                  nativeButton={false}
                  variant="outline"
                  className="mb-4 border-slate-300 bg-white"
                >
                  <ArrowLeft className="size-4" />
                  Back to runs
                </Button>
                <p className="text-xs uppercase tracking-[0.32em] text-teal-700">Run detail</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">{run.workflow_name}</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-600">{run.id}</p>
              </div>

              <div className="rounded-3xl border border-slate-200/80 bg-white p-4 text-sm shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
                <div className="mb-2 flex items-center gap-2 font-medium text-slate-950">
                  <Bot className="size-4 text-teal-600" />
                  {run.agent_name}
                </div>
                <div className="text-slate-600">Started {formatDate(run.started_at)}</div>
                <div className="text-slate-600">Ended {formatDate(run.ended_at)}</div>
              </div>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-4">
              <StatsCard icon={FileSearch2} label="Spans" value={String(spans.length)} />
              <StatsCard icon={Timer} label="Status" value={run.status} />
              <StatsCard icon={Coins} label="Tokens" value={String(metrics?.total_tokens ?? 0)} />
              <StatsCard
                icon={Coins}
                label="Estimated cost"
                value={`$${(metrics?.estimated_cost ?? 0).toFixed(5)}`}
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <SpanTree spans={spans} />
              <div className="space-y-6">
                <PromptViewer artifacts={artifacts} />
                <InsightsPanel insights={insights} />
                <RcaPanel rootCause={rootCause} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

type StatsCardProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
};

function StatsCard({ icon: Icon, label, value }: StatsCardProps) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
      <div className="mb-3 inline-flex rounded-2xl bg-teal-50 p-3 text-teal-700">
        <Icon className="size-5" />
      </div>
      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</div>
    </div>
  );
}
