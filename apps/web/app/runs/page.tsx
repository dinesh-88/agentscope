import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { AppShell } from "@/components/app-shell";
import { ArtifactSearchPanel } from "@/components/artifact-search-panel";
import { RunsAutoRefresh } from "@/components/runs-auto-refresh";
import { getRuns, getRunsFiltered } from "@/lib/server-api";
import { formatUsd } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

type RunsPageProps = {
  searchParams?: Promise<{
    agent?: string | string[];
    trace_id?: string | string[];
  }>;
};

function normalizeQueryParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
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

function readTraceIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).trace_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isFailureStatus(status: string) {
  const normalized = status.toLowerCase();
  return normalized === "failed" || normalized === "error";
}

function buildTraceGroups(runs: Awaited<ReturnType<typeof getRuns>>) {
  const groups = new Map<string, { traceId: string | null; runs: typeof runs }>();

  for (const run of runs) {
    const traceId = readTraceIdFromMetadata(run.metadata);
    const key = traceId ?? "__no_trace__";
    if (!groups.has(key)) {
      groups.set(key, { traceId, runs: [] });
    }
    groups.get(key)!.runs.push(run);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      runs: [...group.runs].sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at)),
    }))
    .sort((a, b) => {
      if (a.traceId && !b.traceId) return -1;
      if (!a.traceId && b.traceId) return 1;
      const aStarted = +new Date(a.runs[0]?.started_at ?? 0);
      const bStarted = +new Date(b.runs[0]?.started_at ?? 0);
      return bStarted - aStarted;
    });
}

export default async function RunsPage({ searchParams }: RunsPageProps) {
  noStore();
  const params = searchParams ? await searchParams : undefined;
  const agentFilter = normalizeQueryParam(params?.agent)?.trim();
  const traceIdFilter = normalizeQueryParam(params?.trace_id)?.trim();
  const runs =
    agentFilter || traceIdFilter
      ? await getRunsFiltered({
        agent_name: agentFilter,
        trace_id: traceIdFilter,
      })
      : await getRuns();
  const filteredRuns = runs.filter((run) => {
    if (agentFilter && (run.agent_name ?? "").toLowerCase() !== agentFilter.toLowerCase()) {
      return false;
    }
    if (traceIdFilter && readTraceIdFromMetadata(run.metadata) !== traceIdFilter) {
      return false;
    }
    return true;
  });
  const traceGroups = buildTraceGroups(filteredRuns);

  return (
    <AppShell activePath="/runs">
      <RunsAutoRefresh />
      <div className="p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-semibold text-gray-900">Runs</h1>
            <p className="text-gray-600">
              {traceIdFilter
                ? `Showing runs for trace: ${traceIdFilter}`
                : agentFilter
                  ? `Showing runs for agent: ${agentFilter}`
                : "Browse all workflow runs from production data"}
            </p>
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
            <h2 className="text-base font-medium text-gray-900">
              {agentFilter ? `Filtered Runs (${filteredRuns.length})` : `All Runs (${filteredRuns.length})`}
            </h2>
          </div>

          <div className="space-y-3 px-6 pb-6">
            {filteredRuns.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                {agentFilter
                  ? "No runs found for this filter."
                  : traceIdFilter
                    ? "No runs found for this trace."
                    : "No runs yet. Run the demo app to generate your first trace."}
              </div>
            ) : (
              traceGroups.map((group, index) => {
                const latestFailed = group.runs.find((run) => isFailureStatus(run.status));
                const latestSuccess = group.runs.find((run) => !isFailureStatus(run.status));
                const compareHref =
                  latestFailed && latestSuccess && latestFailed.id !== latestSuccess.id
                    ? `/runs/compare/${latestFailed.id}/${latestSuccess.id}`
                    : null;
                const failedCount = group.runs.filter((run) => isFailureStatus(run.status)).length;
                const newestRun = group.runs[0];

                return (
                  <details
                    key={`group-${group.traceId ?? `no-trace-${index}`}`}
                    open={Boolean(traceIdFilter) || index === 0}
                    className="rounded-lg border border-gray-200 bg-white"
                  >
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-900">Group {index + 1}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                          {group.runs.length} run{group.runs.length === 1 ? "" : "s"}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                          {failedCount} failed
                        </span>
                        {newestRun ? (
                          <span className="text-xs text-gray-500">Latest: {formatDate(newestRun.started_at)}</span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {group.traceId ? (
                          <Link href={`/runs?trace_id=${encodeURIComponent(group.traceId)}`} className="text-blue-600 hover:text-blue-500">
                            Filter to this group
                          </Link>
                        ) : null}
                        {compareHref ? (
                          <Link href={compareHref} className="text-blue-600 hover:text-blue-500">
                            Compare latest failed vs success
                          </Link>
                        ) : null}
                      </div>
                    </summary>

                    <div className="border-t border-gray-200 px-4 py-3">
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
                            {group.runs.map((run) => {
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
                                  <td className="py-4 text-sm text-gray-600">{totalCostUsd > 0 ? formatUsd(totalCostUsd, { decimals: 3, tinyThreshold: 0.001 }) : "-"}</td>
                                  <td className="py-4 text-sm text-gray-600">{formatDate(run.started_at)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                );
              })
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
