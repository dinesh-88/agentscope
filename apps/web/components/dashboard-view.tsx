"use client";

import Link from "next/link";
import { Activity, AlertTriangle, Clock, DollarSign } from "lucide-react";

import { useAppTheme } from "@/components/app-shell";
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

function normalizeStatus(status: string) {
  if (status === "success") return "completed";
  if (status === "error") return "failed";
  return status;
}

export function DashboardView({ runs }: { runs: Run[] }) {
  const { theme } = useAppTheme();
  const dark = theme === "dark";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const runsToday = runs.filter((run) => {
    const started = new Date(run.started_at).getTime();
    return !Number.isNaN(started) && started >= todayStart;
  });

  const failedRuns = runsToday.filter((run) => normalizeStatus(run.status) === "failed").length;
  const avgLatency = runsToday.length > 0 ? runsToday.reduce((sum, run) => sum + durationMs(run), 0) / runsToday.length : 0;
  const tokenUsage = runsToday.reduce((sum, run) => sum + (run.total_tokens ?? 0), 0);
  const totalCost = runsToday.reduce((sum, run) => sum + (run.total_cost_usd ?? 0), 0);

  const runsByStatusMap = runsToday.reduce<Record<string, number>>((acc, run) => {
    const key = normalizeStatus(run.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const runsByStatus = [
    { status: "completed", count: runsByStatusMap.completed ?? 0 },
    { status: "running", count: runsByStatusMap.running ?? 0 },
    { status: "failed", count: runsByStatusMap.failed ?? 0 },
    { status: "pending", count: runsByStatusMap.pending ?? 0 },
  ];

  const recentRuns = [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 5);

  const statCards = [
    {
      title: "Runs Today",
      value: runsToday.length,
      icon: Activity,
      color: dark ? "text-blue-300" : "text-blue-600",
      bgColor: dark ? "bg-blue-500/20" : "bg-blue-50",
    },
    {
      title: "Failed Runs",
      value: failedRuns,
      icon: AlertTriangle,
      color: dark ? "text-red-300" : "text-red-600",
      bgColor: dark ? "bg-red-500/20" : "bg-red-50",
    },
    {
      title: "Avg Latency",
      value: `${(avgLatency / 1000).toFixed(1)}s`,
      icon: Clock,
      color: dark ? "text-yellow-300" : "text-yellow-600",
      bgColor: dark ? "bg-yellow-500/20" : "bg-yellow-50",
    },
    {
      title: "Token Usage",
      value: tokenUsage.toLocaleString(),
      icon: DollarSign,
      color: dark ? "text-green-300" : "text-green-600",
      bgColor: dark ? "bg-green-500/20" : "bg-green-50",
    },
  ];

  function statusBadge(status: string) {
    switch (status) {
      case "completed":
        return dark ? "bg-green-500/20 text-green-300" : "bg-green-100 text-green-800";
      case "running":
        return dark ? "bg-blue-500/20 text-blue-300" : "bg-blue-100 text-blue-800";
      case "failed":
        return dark ? "bg-red-500/20 text-red-300" : "bg-red-100 text-red-800";
      case "pending":
        return dark ? "bg-gray-500/20 text-gray-300" : "bg-gray-100 text-gray-800";
      default:
        return dark ? "bg-gray-500/20 text-gray-300" : "bg-gray-100 text-gray-800";
    }
  }

  return (
    <div className={dark ? "bg-[#0B0F14] p-8" : "bg-gray-50 p-8"}>
      <div className="mb-8">
        <h1 className={dark ? "mb-2 text-2xl font-semibold text-gray-100" : "mb-2 text-2xl font-semibold text-gray-900"}>Dashboard</h1>
        <p className={dark ? "text-gray-400" : "text-gray-600"}>Monitor your agent workflows and performance</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.title} className={dark ? "rounded-xl border border-white/10 bg-[#101722] p-6" : "rounded-xl border border-gray-200 bg-white p-6"}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={dark ? "text-sm text-gray-400" : "text-sm text-gray-600"}>{stat.title}</p>
                  <p className={dark ? "mt-2 text-3xl font-semibold text-gray-100" : "mt-2 text-3xl font-semibold text-gray-900"}>{stat.value}</p>
                </div>
                <div className={`rounded-lg p-3 ${stat.bgColor}`}>
                  <Icon className={`h-6 w-6 ${stat.color}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={dark ? "rounded-xl border border-white/10 bg-[#101722]" : "rounded-xl border border-gray-200 bg-white"}>
          <div className="p-6 pb-4">
            <h2 className={dark ? "text-base font-medium text-gray-100" : "text-base font-medium text-gray-900"}>Run Status Distribution</h2>
          </div>
          <div className="px-6 pb-6">
            <div className="space-y-3">
              {runsByStatus.map(({ status, count }) => (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-3 w-3 rounded-full ${status === "completed" ? "bg-green-500" : status === "running" ? "bg-blue-500" : status === "failed" ? "bg-red-500" : "bg-gray-500"}`} />
                    <span className={dark ? "text-sm text-gray-300 capitalize" : "text-sm text-gray-700 capitalize"}>{status}</span>
                  </div>
                  <span className={dark ? "text-sm font-semibold text-gray-100" : "text-sm font-semibold text-gray-900"}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={dark ? "rounded-xl border border-white/10 bg-[#101722]" : "rounded-xl border border-gray-200 bg-white"}>
          <div className="p-6 pb-4">
            <h2 className={dark ? "text-base font-medium text-gray-100" : "text-base font-medium text-gray-900"}>Cost Summary</h2>
          </div>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <p className={dark ? "text-sm text-gray-400" : "text-sm text-gray-600"}>Total Cost Today</p>
              <p className={dark ? "mt-1 text-2xl font-semibold text-gray-100" : "mt-1 text-2xl font-semibold text-gray-900"}>${totalCost.toFixed(3)}</p>
            </div>
            <div>
              <p className={dark ? "text-sm text-gray-400" : "text-sm text-gray-600"}>Tokens Used</p>
              <p className={dark ? "mt-1 text-xl font-semibold text-gray-100" : "mt-1 text-xl font-semibold text-gray-900"}>{tokenUsage.toLocaleString()}</p>
            </div>
            <div>
              <p className={dark ? "text-sm text-gray-400" : "text-sm text-gray-600"}>Avg Cost per Run</p>
              <p className={dark ? "mt-1 text-xl font-semibold text-gray-100" : "mt-1 text-xl font-semibold text-gray-900"}>
                ${runsToday.length > 0 ? (totalCost / runsToday.length).toFixed(4) : "0.0000"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className={dark ? "rounded-xl border border-white/10 bg-[#101722]" : "rounded-xl border border-gray-200 bg-white"}>
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className={dark ? "text-base font-medium text-gray-100" : "text-base font-medium text-gray-900"}>Recent Runs</h2>
          <Link href="/runs" className={dark ? "text-sm text-blue-300 hover:text-blue-200" : "text-sm text-blue-600 hover:text-blue-700"}>
            View all
          </Link>
        </div>

        <div className="px-6 pb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className={dark ? "border-b border-white/10" : "border-b border-gray-200"}>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Run Name</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Agent</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Status</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Duration</th>
                  <th className={dark ? "pb-3 text-left text-sm font-medium text-gray-400" : "pb-3 text-left text-sm font-medium text-gray-600"}>Tokens</th>
                </tr>
              </thead>
              <tbody className={dark ? "divide-y divide-white/10" : "divide-y divide-gray-100"}>
                {recentRuns.map((run) => {
                  const status = normalizeStatus(run.status);
                  return (
                    <tr key={run.id} className={dark ? "hover:bg-white/5" : "hover:bg-gray-50"}>
                      <td className="py-4">
                        <Link href={`/runs/${run.id}`} className={dark ? "text-sm font-medium text-gray-100 hover:text-blue-300" : "text-sm font-medium text-gray-900 hover:text-blue-600"}>
                          {run.workflow_name}
                        </Link>
                      </td>
                      <td className={dark ? "py-4 text-sm text-gray-300" : "py-4 text-sm text-gray-600"}>{run.agent_name}</td>
                      <td className="py-4">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${statusBadge(status)}`}>{status}</span>
                      </td>
                      <td className={dark ? "py-4 text-sm text-gray-300" : "py-4 text-sm text-gray-600"}>{formatDuration(durationMs(run))}</td>
                      <td className={dark ? "py-4 text-sm text-gray-300" : "py-4 text-sm text-gray-600"}>{(run.total_tokens ?? 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
