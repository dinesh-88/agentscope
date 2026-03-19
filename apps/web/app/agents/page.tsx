import { Activity, CheckCircle, Clock } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type AgentSummary = {
  name: string;
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  lastRunAt: string | null;
};

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
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

function toAgentSummaries(
  runs: Array<{
    agent_name: string;
    status: string;
    started_at: string;
    ended_at: string | null;
  }>,
): AgentSummary[] {
  const buckets = new Map<
    string,
    {
      totalRuns: number;
      successRuns: number;
      durationMsTotal: number;
      durationSamples: number;
      lastRunAt: string | null;
    }
  >();

  for (const run of runs) {
    const key = run.agent_name || "Unknown Agent";
    const current = buckets.get(key) ?? {
      totalRuns: 0,
      successRuns: 0,
      durationMsTotal: 0,
      durationSamples: 0,
      lastRunAt: null,
    };

    current.totalRuns += 1;
    if (run.status === "completed" || run.status === "success") {
      current.successRuns += 1;
    }

    if (run.started_at && run.ended_at) {
      const duration = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime();
      if (Number.isFinite(duration) && duration >= 0) {
        current.durationMsTotal += duration;
        current.durationSamples += 1;
      }
    }

    if (!current.lastRunAt || new Date(run.started_at).getTime() > new Date(current.lastRunAt).getTime()) {
      current.lastRunAt = run.started_at;
    }

    buckets.set(key, current);
  }

  return Array.from(buckets.entries())
    .map(([name, value]) => ({
      name,
      totalRuns: value.totalRuns,
      successRate: value.totalRuns > 0 ? Math.round((value.successRuns / value.totalRuns) * 100) : 0,
      avgDurationMs: value.durationSamples > 0 ? value.durationMsTotal / value.durationSamples : 0,
      lastRunAt: value.lastRunAt,
    }))
    .sort((a, b) => b.totalRuns - a.totalRuns);
}

export default async function AgentsPage() {
  const runs = await getRuns();
  const agents = toAgentSummaries(runs);

  return (
    <AppShell activePath="/agents">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Agents</h1>
          <p className="text-gray-600">Production agent stats from your actual runs</p>
        </div>

        {agents.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
            No runs yet. Run the demo app to generate your first trace.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {agents.map((agent) => (
              <div key={agent.name} className="rounded-xl border border-gray-200 bg-white p-6">
                <h2 className="text-base font-medium text-gray-900">{agent.name}</h2>

                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-blue-600" />
                        <p className="text-xs text-gray-600">Total Runs</p>
                      </div>
                      <p className="text-xl font-semibold text-gray-900">{agent.totalRuns}</p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <p className="text-xs text-gray-600">Success Rate</p>
                      </div>
                      <p className="text-xl font-semibold text-gray-900">{agent.successRate}%</p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-orange-600" />
                        <p className="text-xs text-gray-600">Avg Duration</p>
                      </div>
                      <p className="text-xl font-semibold text-gray-900">{formatDuration(agent.avgDurationMs)}</p>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm text-gray-600">Performance</span>
                      <span className="text-sm font-medium text-gray-900">{agent.successRate}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-200">
                      <div
                        className={`h-2 rounded-full ${
                          agent.successRate >= 95
                            ? "bg-green-500"
                            : agent.successRate >= 90
                              ? "bg-blue-500"
                              : agent.successRate >= 85
                                ? "bg-yellow-500"
                                : "bg-red-500"
                        }`}
                        style={{ width: `${agent.successRate}%` }}
                      />
                    </div>
                  </div>

                  {agent.lastRunAt ? (
                    <div className="border-t border-gray-200 pt-4">
                      <p className="mb-1 text-xs text-gray-600">Last Run</p>
                      <p className="text-sm text-gray-900">{formatDate(agent.lastRunAt)}</p>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
