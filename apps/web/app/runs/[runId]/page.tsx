import type { ComponentType } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, Coins, FileSearch2, Timer } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { InsightsPanel } from "@/components/insights-panel";
import { PromptViewer } from "@/components/prompt-viewer";
import { RcaPanel } from "@/components/rca-panel";
import { SpanDetailsPanel } from "@/components/span-details-panel";
import { SpanTree } from "@/components/span-tree";
import { Button } from "@/components/ui/button";
import { getRun, getRunArtifacts, getRunInsights, getRunMetrics, getRunRootCause, getRunSpans } from "@/lib/server-api";

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

  if (!run) {
    notFound();
  }

  return (
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <Button
              render={<Link href="/runs" />}
              nativeButton={false}
              variant="outline"
              className="mb-4 border-black/8 bg-white shadow-none hover:bg-gray-50"
            >
              <ArrowLeft className="size-4" />
              Back to Runs
            </Button>
            <h1 className="text-gray-900">{run.workflow_name}</h1>
            <div className="mt-2 max-w-2xl text-sm text-gray-500">{run.id}</div>
          </div>

          <div className="rounded-lg border border-black/8 bg-white p-4 text-sm shadow-none">
            <div className="mb-2 flex items-center gap-2 font-medium text-gray-900">
              <Bot className="size-4 text-blue-600" />
              {run.agent_name}
            </div>
            <div className="text-gray-600">Started {formatDate(run.started_at)}</div>
            <div className="text-gray-600">Ended {formatDate(run.ended_at)}</div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <StatsCard icon={FileSearch2} label="Spans" value={String(spans.length)} tone="blue" />
          <StatsCard icon={Timer} label="Status" value={run.status} tone="gray" />
          <StatsCard icon={Coins} label="Tokens" value={String(metrics?.total_tokens ?? 0)} tone="green" />
          <StatsCard
            icon={Coins}
            label="Estimated cost"
            value={`$${(metrics?.estimated_cost ?? 0).toFixed(5)}`}
            tone="yellow"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <SpanTree spans={spans} />
          <div className="space-y-6">
            <SpanDetailsPanel spans={spans} artifacts={artifacts} />
            <PromptViewer artifacts={artifacts} />
            <InsightsPanel insights={insights} />
            <RcaPanel rootCause={rootCause} />
          </div>
        </div>
      </section>
    </AppShell>
  );
}

type StatsCardProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "blue" | "gray" | "green" | "yellow";
};

function StatsCard({ icon: Icon, label, value, tone }: StatsCardProps) {
  const toneClasses = {
    blue: "bg-blue-50 text-blue-600",
    gray: "bg-gray-100 text-gray-600",
    green: "bg-green-50 text-green-600",
    yellow: "bg-yellow-50 text-yellow-600",
  };

  return (
    <div className="rounded-lg border border-black/8 bg-white p-5 shadow-none">
      <div className={`mb-3 inline-flex rounded-lg p-3 ${toneClasses[tone]}`}>
        <Icon className="size-5" />
      </div>
      <div className="text-xs uppercase tracking-[0.24em] text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-gray-950">{value}</div>
    </div>
  );
}
