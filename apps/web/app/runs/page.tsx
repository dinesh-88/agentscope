import type { ComponentType } from "react";
import { Activity, ClockArrowUp, Server } from "lucide-react";

import { RunTable } from "@/components/run-table";
import { Sidebar } from "@/components/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRuns } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await getRuns();
  const runningCount = runs.filter((run) => run.status === "running").length;
  const failedCount = runs.filter((run) => run.status === "failed" || run.status === "error").length;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_28%),linear-gradient(180deg,#f7fbff_0%,#eef4f8_100%)] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Sidebar activePath="/runs" />

        <section className="space-y-6">
          <div className="rounded-[32px] border border-white/70 bg-white/70 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-cyan-700">Telemetry overview</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight">Recent AI agent runs</h2>
              </div>
              <p className="max-w-xl text-sm text-slate-600">
                Live list of ingested runs from the AgentScope API. Open any run to inspect spans,
                prompt artifacts, optimization insights, and root cause analysis.
              </p>
            </div>

            <div className="mb-6 grid gap-4 md:grid-cols-3">
              <MetricCard icon={Activity} label="Total runs" value={String(runs.length)} tone="cyan" />
              <MetricCard icon={ClockArrowUp} label="Running" value={String(runningCount)} tone="amber" />
              <MetricCard icon={Server} label="Failed" value={String(failedCount)} tone="rose" />
            </div>

            <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
              <CardHeader>
                <CardTitle>Run list</CardTitle>
              </CardHeader>
              <CardContent>
                <RunTable runs={runs} />
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}

type MetricCardProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: "cyan" | "amber" | "rose";
};

function MetricCard({ icon: Icon, label, value, tone }: MetricCardProps) {
  const styles = {
    cyan: "bg-cyan-50 text-cyan-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  };

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
      <div className={`mb-4 inline-flex rounded-2xl p-3 ${styles[tone]}`}>
        <Icon className="size-5" />
      </div>
      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
    </div>
  );
}
