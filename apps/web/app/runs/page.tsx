"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { mockRuns } from "@/figma/src/app/data/mockData";
import { type RunStatus } from "@/figma/src/app/types";

function getStatusColor(status: string) {
  switch (status) {
    case "completed":
      return "bg-green-100 text-green-800";
    case "running":
      return "bg-blue-100 text-blue-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "pending":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function formatDuration(ms: number) {
  if (ms === 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function RunsPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "all">("all");

  const filteredRuns = mockRuns.filter((run) => {
    const matchesSearch =
      run.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      run.agentName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || run.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <AppShell activePath="/runs">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Runs</h1>
          <p className="text-gray-600">Browse and filter all workflow runs</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-medium text-gray-900">All Runs ({filteredRuns.length})</h2>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search runs..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="h-10 w-full rounded-lg border border-gray-300 bg-white pr-3 pl-9 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as RunStatus | "all")}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="all">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="running">Running</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Run Name</th>
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Agent</th>
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Duration</th>
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Tokens</th>
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Cost</th>
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRuns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                        No runs found
                      </td>
                    </tr>
                  ) : (
                    filteredRuns.map((run) => (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="py-4">
                          <Link href={`/runs/${run.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                            {run.name}
                          </Link>
                        </td>
                        <td className="py-4 text-sm text-gray-600">{run.agentName}</td>
                        <td className="py-4">
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusColor(run.status)}`}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="py-4 text-sm text-gray-600">{formatDuration(run.duration)}</td>
                        <td className="py-4 text-sm text-gray-600">{run.tokensUsed > 0 ? run.tokensUsed.toLocaleString() : "-"}</td>
                        <td className="py-4 text-sm text-gray-600">{run.cost > 0 ? `$${run.cost.toFixed(3)}` : "-"}</td>
                        <td className="py-4 text-sm text-gray-600">{formatDate(run.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
