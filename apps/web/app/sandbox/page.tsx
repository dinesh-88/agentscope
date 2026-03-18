"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Loader2, PlayCircle, XCircle } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import {
  getSandboxStatus,
  runSandbox,
  type SandboxStatusResponse,
  type SandboxTarget,
  type SandboxTargetStatus,
} from "@/lib/api";

type TargetConfig = {
  id: SandboxTarget;
  name: string;
  description: string;
};

const targets: TargetConfig[] = [
  {
    id: "python",
    name: "Python Mock Agent",
    description: "Runs a deterministic mock agent flow with synthetic tool and LLM spans.",
  },
  {
    id: "real",
    name: "Real OpenAI Agent",
    description: "Runs the real Python agent using OpenAI and publishes live telemetry.",
  },
  {
    id: "ts",
    name: "TypeScript Agent",
    description: "Runs the TS sandbox agent runtime using compiled demo code.",
  },
];

function normalizeRunStatus(status: string): "idle" | "running" | "success" | "failed" {
  if (status === "running") return "running";
  if (status === "success") return "success";
  if (status === "failed") return "failed";
  return "idle";
}

function statusIcon(status: string) {
  const normalized = normalizeRunStatus(status);
  if (normalized === "running") return <Loader2 className="h-5 w-5 animate-spin text-blue-400" />;
  if (normalized === "success") return <CheckCircle className="h-5 w-5 text-green-400" />;
  if (normalized === "failed") return <XCircle className="h-5 w-5 text-red-400" />;
  return <PlayCircle className="h-5 w-5 text-slate-400" />;
}

function statusLabel(status: string) {
  const normalized = normalizeRunStatus(status);
  if (normalized === "running") return "Running";
  if (normalized === "success") return "Completed";
  if (normalized === "failed") return "Failed";
  return "Idle";
}

function targetStatusById(status: SandboxStatusResponse | null, target: SandboxTarget): SandboxTargetStatus | null {
  if (!status) return null;
  if (target === "python") return status.python;
  if (target === "real") return status.real;
  return status.ts;
}

function formatDate(value: string | null) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function SandboxPage() {
  const [status, setStatus] = useState<SandboxStatusResponse | null>(null);
  const [loadingTarget, setLoadingTarget] = useState<SandboxTarget | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const latest = await getSandboxStatus();
      setStatus(latest);
      setPageError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load sandbox status.";
      setPageError(message);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const targetRows = useMemo(
    () =>
      targets.map((target) => ({
        ...target,
        runtime: targetStatusById(status, target.id),
      })),
    [status],
  );

  async function runTarget(target: SandboxTarget) {
    setLoadingTarget(target);
    try {
      await runSandbox(target);
      await refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to run ${target} sandbox target.`;
      setPageError(message);
    } finally {
      setLoadingTarget(null);
    }
  }

  return (
    <AppShell activePath="/sandbox">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Sandbox</h1>
          <p className="text-gray-600">Run mock and real sandbox agents and inspect runtime status.</p>
        </div>

        {pageError && (
          <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            {pageError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {targetRows.map((target) => {
            const currentStatus = target.runtime?.status ?? "idle";
            const isRunning = currentStatus === "running";
            const isStarting = loadingTarget === target.id;
            return (
              <div key={target.id} className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-900">{target.name}</h2>
                  {statusIcon(currentStatus)}
                </div>
                <p className="text-sm text-gray-600">{target.description}</p>

                <div className="mt-4 space-y-1 text-xs text-gray-500">
                  <p>Status: <span className="font-medium text-gray-800">{statusLabel(currentStatus)}</span></p>
                  <p>Started: <span className="text-gray-700">{formatDate(target.runtime?.last_started_at ?? null)}</span></p>
                  <p>Finished: <span className="text-gray-700">{formatDate(target.runtime?.last_finished_at ?? null)}</span></p>
                  <p>Exit code: <span className="text-gray-700">{target.runtime?.last_exit_code ?? "n/a"}</span></p>
                </div>

                {target.runtime?.last_error && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                    {target.runtime.last_error}
                  </div>
                )}

                <button
                  onClick={() => runTarget(target.id)}
                  disabled={isRunning || isStarting}
                  type="button"
                  className="mt-5 inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  <span className="ml-2">{isRunning ? "Running..." : "Run"}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
