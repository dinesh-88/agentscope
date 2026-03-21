import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { AppShell } from "@/components/app-shell";
import { ArtifactSearchPanel } from "@/components/artifact-search-panel";
import { RunsAutoRefresh } from "@/components/runs-auto-refresh";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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

function formatDuration(startedAt: string, endedAt: string | null) {
  if (!endedAt) return "-";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function RunsPage() {
  noStore();
  const runs = await getRuns();

  return (
    <AppShell activePath="/runs">
      <RunsAutoRefresh intervalMs={5000} />
      <div className="p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-semibold text-gray-900">Runs</h1>
            <p className="text-gray-600">Browse all workflow runs from production data</p>
          </div>
          <Link
            href="/runs/compare"
            data-testid="compare-button"
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            Compare runs
          </Link>
        </div>

        <ArtifactSearchPanel />

        <div className="rounded-xl border border-gray-200 bg-white">
          <div className="p-6">
            <h2 className="text-base font-medium text-gray-900">All Runs ({runs.length})</h2>
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
                    <th className="pb-3 text-left text-sm font-medium text-gray-600">Started At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-gray-500">
                        No runs yet. Run the demo app to generate your first trace.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => {
                      const totalTokens = run.total_tokens ?? 0;
                      const totalCostUsd = run.total_cost_usd ?? 0;

                      return (
                        <tr key={run.id} data-testid="run-item" className="hover:bg-gray-50">
                          <td className="py-4">
                            <Link href={`/runs/${run.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                              {run.workflow_name}
                            </Link>
                          </td>
                          <td className="py-4 text-sm text-gray-600">{run.agent_name}</td>
                          <td className="py-4">
                            <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ${getStatusColor(run.status)}`}>
                              {run.status}
                            </span>
                          </td>
                          <td className="py-4 text-sm text-gray-600">{formatDuration(run.started_at, run.ended_at)}</td>
                          <td className="py-4 text-sm text-gray-600">{totalTokens > 0 ? totalTokens.toLocaleString() : "-"}</td>
                          <td className="py-4 text-sm text-gray-600">{totalCostUsd > 0 ? `$${totalCostUsd.toFixed(3)}` : "-"}</td>
                          <td className="py-4 text-sm text-gray-600">{formatDate(run.started_at)}</td>
                        </tr>
                      );
                    })
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
