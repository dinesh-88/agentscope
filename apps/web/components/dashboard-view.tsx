"use client";

import Link from "next/link";
import { Activity, AlertTriangle, Clock, DollarSign } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Run } from "@/lib/api";

function durationMs(run: Run) {
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
    case "success":
      return "bg-green-100 text-green-800";
    case "running":
      return "bg-blue-100 text-blue-800";
    case "failed":
    case "error":
      return "bg-red-100 text-red-800";
    case "pending":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function normalizeStatus(status: string) {
  if (status === "success") return "completed";
  if (status === "error") return "failed";
  return status;
}

export function DashboardView({ runs }: { runs: Run[] }) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const runsToday = runs.filter((run) => {
    const started = new Date(run.started_at).getTime();
    return !Number.isNaN(started) && started >= todayStart;
  });

  const failedRuns = runsToday.filter((run) => run.status === "failed" || run.status === "error").length;
  const avgLatency =
    runsToday.length > 0
      ? runsToday.reduce((sum, run) => sum + durationMs(run), 0) / runsToday.length
      : 0;
  const tokenUsage = runsToday.reduce((sum, run) => sum + (run.total_tokens ?? 0), 0);
  const totalCost = runsToday.reduce((sum, run) => sum + (run.total_cost_usd ?? 0), 0);

  const runsByStatus = runsToday.reduce<Record<string, number>>((acc, run) => {
    const key = normalizeStatus(run.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const recentRuns = [...runs]
    .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
    .slice(0, 5);

  const statCards = [
    {
      title: "Runs Today",
      value: runsToday.length,
      icon: Activity,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Failed Runs",
      value: failedRuns,
      icon: AlertTriangle,
      color: "text-red-600",
      bgColor: "bg-red-50",
    },
    {
      title: "Avg Latency",
      value: `${(avgLatency / 1000).toFixed(1)}s`,
      icon: Clock,
      color: "text-yellow-600",
      bgColor: "bg-yellow-50",
    },
    {
      title: "Token Usage",
      value: tokenUsage.toLocaleString(),
      icon: DollarSign,
      color: "text-green-600",
      bgColor: "bg-green-50",
    },
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Monitor your agent workflows and performance</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="py-0">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">{stat.title}</p>
                    <p className="mt-2 text-3xl font-semibold text-gray-900">{stat.value}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${stat.bgColor}`}>
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="py-0">
          <CardHeader>
            <CardTitle>Run Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(runsByStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-3 w-3 rounded-full ${
                        status === "completed"
                          ? "bg-green-500"
                          : status === "running"
                            ? "bg-blue-500"
                            : status === "failed"
                              ? "bg-red-500"
                              : "bg-gray-500"
                      }`}
                    />
                    <span className="text-sm text-gray-700 capitalize">{status}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{count}</span>
                </div>
              ))}
              {Object.keys(runsByStatus).length === 0 ? (
                <p className="text-sm text-gray-500">No runs for today.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader>
            <CardTitle>Cost Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Total Cost Today</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">${totalCost.toFixed(3)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Tokens Used</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">{tokenUsage.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg Cost per Run</p>
                <p className="mt-1 text-xl font-semibold text-gray-900">
                  ${runsToday.length > 0 ? (totalCost / runsToday.length).toFixed(4) : "0.0000"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="py-0">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Runs</CardTitle>
            <Link href="/runs" className="text-sm text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Run Name</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Agent</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Status</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Duration</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="py-4">
                      <Link href={`/runs/${run.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                        {run.workflow_name}
                      </Link>
                    </td>
                    <td className="py-4 text-sm text-gray-600">{run.agent_name}</td>
                    <td className="py-4">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusColor(run.status)}`}
                      >
                        {normalizeStatus(run.status)}
                      </span>
                    </td>
                    <td className="py-4 text-sm text-gray-600">{formatDuration(durationMs(run))}</td>
                    <td className="py-4 text-sm text-gray-600">{(run.total_tokens ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
                {recentRuns.length === 0 ? (
                  <tr>
                    <td className="py-6 text-sm text-gray-500" colSpan={5}>
                      No runs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
