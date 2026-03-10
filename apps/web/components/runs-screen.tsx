"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Run } from "@/lib/api";

type RunsScreenProps = {
  runs: Run[];
};

function formatDate(value: string | null) {
  if (!value) return "In progress";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function RunsScreen({ runs }: RunsScreenProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredRuns = useMemo(
    () =>
      runs.filter((run) => {
        const query = searchTerm.toLowerCase();
        const matchesSearch =
          run.workflow_name.toLowerCase().includes(query) || run.agent_name.toLowerCase().includes(query);
        const matchesStatus = statusFilter === "all" || run.status === statusFilter;

        return matchesSearch && matchesStatus;
      }),
    [runs, searchTerm, statusFilter],
  );

  return (
    <section className="p-6 sm:p-8">
      <div className="mb-8">
        <h1 className="mb-2 text-gray-900">Runs</h1>
        <p className="text-gray-600">Browse and filter all workflow runs.</p>
      </div>

      <Card className="border border-black/8 shadow-none ring-0">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>All Runs ({filteredRuns.length})</CardTitle>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search runs..."
                  className="h-10 w-full rounded-lg border border-black/8 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="h-10 rounded-lg border border-black/8 bg-white px-3 text-sm outline-none transition focus:border-blue-500"
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="success">Success</option>
                <option value="running">Running</option>
                <option value="failed">Failed</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px]">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Run Name</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Agent</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Status</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Started</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Ended</th>
                  <th className="pb-3 text-left text-sm font-medium text-gray-600">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRuns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-gray-500">
                      No runs found
                    </td>
                  </tr>
                ) : (
                  filteredRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-gray-50">
                      <td className="py-4">
                        <div className="font-medium text-gray-900">{run.workflow_name}</div>
                        <div className="max-w-[280px] truncate text-xs text-gray-500">{run.id}</div>
                      </td>
                      <td className="py-4 text-sm text-gray-600">{run.agent_name}</td>
                      <td className="py-4">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusColor(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="py-4 text-sm text-gray-600">{formatDate(run.started_at)}</td>
                      <td className="py-4 text-sm text-gray-600">{formatDate(run.ended_at)}</td>
                      <td className="py-4 text-sm">
                        <Link href={`/runs/${run.id}`} className="font-medium text-blue-600 hover:text-blue-700">
                          Inspect
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
