import { Activity, AlertTriangle, Clock, DollarSign } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

function parseDurationSeconds(startedAt: string, endedAt: string | null) {
  const started = Date.parse(startedAt);
  const ended = endedAt ? Date.parse(endedAt) : Date.now();

  if (Number.isNaN(started) || Number.isNaN(ended)) {
    return 0;
  }

  return Math.max(0, ended - started) / 1000;
}

export default async function HomePage() {
  const runs = await getRuns();
  const runningCount = runs.filter((run) => run.status === "running").length;
  const failedCount = runs.filter((run) => run.status === "failed" || run.status === "error").length;
  const completedRuns = runs.filter((run) => run.status === "completed" || run.status === "success");
  const avgLatency =
    completedRuns.length > 0
      ? completedRuns.reduce((total, run) => total + parseDurationSeconds(run.started_at, run.ended_at), 0) / completedRuns.length
      : 0;

  const runStatusMap = runs.reduce<Record<string, number>>((accumulator, run) => {
    accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
    return accumulator;
  }, {});

  const recentRuns = [...runs]
    .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
    .slice(0, 5);

  const stats = [
    { label: "Runs Today", value: String(runs.length), icon: Activity, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Failed Runs", value: String(failedCount), icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50" },
    { label: "Avg Latency", value: `${avgLatency.toFixed(1)}s`, icon: Clock, color: "text-yellow-600", bg: "bg-yellow-50" },
    { label: "Running", value: String(runningCount), icon: DollarSign, color: "text-green-600", bg: "bg-green-50" },
  ];

  return (
    <AppShell activePath="/dashboard">
      <section className="p-6 sm:p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Monitor your agent workflows and performance.</p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="border border-black/8 shadow-none ring-0">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-600">{stat.label}</p>
                      <p className="mt-2 text-3xl font-semibold text-gray-900">{stat.value}</p>
                    </div>
                    <div className={`rounded-lg p-3 ${stat.bg}`}>
                      <Icon className={`size-6 ${stat.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Card className="border border-black/8 shadow-none ring-0">
            <CardHeader>
              <CardTitle>Run Status Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(runStatusMap).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`size-3 rounded-full ${
                        status === "completed" || status === "success"
                          ? "bg-green-500"
                          : status === "running"
                            ? "bg-blue-500"
                            : status === "failed" || status === "error"
                              ? "bg-red-500"
                              : "bg-gray-400"
                      }`}
                    />
                    <span className="text-sm capitalize text-gray-700">{status}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{count}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border border-black/8 shadow-none ring-0">
            <CardHeader>
              <CardTitle>Recent Runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentRuns.map((run) => (
                <div key={run.id} className="flex items-center justify-between gap-4 rounded-lg bg-gray-50 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900">{run.workflow_name}</div>
                    <div className="text-sm text-gray-500">{run.agent_name}</div>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium capitalize text-gray-700 ring-1 ring-black/8">
                    {run.status}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
