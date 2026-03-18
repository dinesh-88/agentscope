"use client";

import { Activity, CheckCircle, Clock } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { mockAgents } from "@/figma/src/app/data/mockData";

function formatDuration(ms: number) {
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

export default function AgentsPage() {
  return (
    <AppShell activePath="/agents">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Agents</h1>
          <p className="text-gray-600">Manage and monitor your agent workflows</p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {mockAgents.map((agent) => (
            <div key={agent.id} className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="text-base font-medium text-gray-900">{agent.name}</h2>
              <p className="mt-1 text-sm text-gray-600">{agent.description}</p>

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
                    <p className="text-xl font-semibold text-gray-900">{formatDuration(agent.avgDuration)}</p>
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

                {agent.lastRun ? (
                  <div className="border-t border-gray-200 pt-4">
                    <p className="mb-1 text-xs text-gray-600">Last Run</p>
                    <p className="text-sm text-gray-900">{formatDate(agent.lastRun)}</p>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
