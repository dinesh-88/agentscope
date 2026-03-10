"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  CheckCircle,
  FlaskConical,
  Loader2,
  PlayCircle,
  RadioTower,
  SquareTerminal,
  Terminal,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  API_BASE_URL,
  getClientJwtToken,
  type Run,
  type SandboxStatusResponse,
  getRuns,
  getSandboxStatus,
  runSandbox,
} from "@/lib/api";

const SANDBOX_WORKFLOWS = new Set(["sandbox_python_agent", "sandbox_real_agent", "sandbox_ts_agent"]);
const MAX_LOG_LINES = 40;

type LogEntry = {
  id: string;
  message: string;
};

type SpanCreatedEvent = {
  type: "span_created";
  span: {
    id: string;
    run_id: string;
    name: string;
    span_type: string;
    status: string;
  };
};

type SandboxTarget = "python" | "real" | "ts";

function formatDate(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatStatusLine(status: SandboxStatusResponse["python"]) {
  if (status.status === "running") {
    return `Running${status.pid ? ` (pid ${status.pid})` : ""}`;
  }
  if (status.status === "success") {
    return `Completed${status.last_finished_at ? ` at ${formatDate(status.last_finished_at)}` : ""}`;
  }
  if (status.status === "failed") {
    return status.last_error ?? `Failed${status.last_finished_at ? ` at ${formatDate(status.last_finished_at)}` : ""}`;
  }
  return "Idle";
}

function pushLog(setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>, message: string) {
  setLogs((current) => {
    const next = [...current, { id: `${Date.now()}-${Math.random()}`, message }];
    return next.slice(-MAX_LOG_LINES);
  });
}

function getTargetDisplay(target: SandboxTarget) {
  switch (target) {
    case "python":
      return {
        name: "Python Sandbox",
        description: "Run the local Python demo agent and inspect the generated trace.",
        eta: "~5s",
      };
    case "real":
      return {
        name: "Real OpenAI Sandbox",
        description: "Trigger the OpenAI-backed sandbox flow using the API environment key.",
        eta: "~8s",
      };
    case "ts":
      return {
        name: "TS Sandbox",
        description: "Run the TypeScript sandbox agent and stream span events live.",
        eta: "~6s",
      };
  }
}

function getTargetStatus(target: SandboxTarget, status: SandboxStatusResponse | null, loading: boolean) {
  if (loading) {
    return "running";
  }

  const targetStatus = status?.[target].status;
  if (targetStatus === "success") return "success";
  if (targetStatus === "failed") return "error";
  if (targetStatus === "running") return "running";
  return "idle";
}

function getStatusIcon(state: "idle" | "running" | "success" | "error") {
  switch (state) {
    case "running":
      return <Loader2 className="size-5 animate-spin text-blue-600" />;
    case "success":
      return <CheckCircle className="size-5 text-green-600" />;
    case "error":
      return <XCircle className="size-5 text-red-600" />;
    default:
      return <PlayCircle className="size-5" />;
  }
}

function getStatusText(state: "idle" | "running" | "success" | "error") {
  switch (state) {
    case "running":
      return "Running...";
    case "success":
      return "Completed";
    case "error":
      return "Failed";
    default:
      return "Run";
  }
}

export default function SandboxPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [status, setStatus] = useState<SandboxStatusResponse | null>(null);
  const [loading, setLoading] = useState({ python: false, real: false, ts: false });
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const knownRunIds = useRef<Set<string>>(new Set());

  const sandboxRuns = useMemo(
    () =>
      runs
        .filter((run) => SANDBOX_WORKFLOWS.has(run.workflow_name))
        .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at)),
    [runs],
  );

  useEffect(() => {
    knownRunIds.current = new Set(sandboxRuns.map((run) => run.id));
  }, [sandboxRuns]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const [nextRuns, nextStatus] = await Promise.all([getRuns(), getSandboxStatus()]);
        if (!cancelled) {
          setRuns(nextRuns);
          setStatus(nextStatus);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load sandbox data.");
        }
      }
    }

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const token = getClientJwtToken();
    const events = new EventSource(
      token ? `${API_BASE_URL}/v1/events/stream?access_token=${encodeURIComponent(token)}` : `${API_BASE_URL}/v1/events/stream`,
    );

    events.addEventListener("span_created", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as SpanCreatedEvent;
        if (!knownRunIds.current.has(payload.span.run_id)) {
          return;
        }

        pushLog(
          setLogs,
          `${payload.span.run_id.slice(0, 8)} · ${payload.span.span_type} · ${payload.span.name} · ${payload.span.status}`,
        );
      } catch {
        pushLog(setLogs, "Received an unreadable sandbox event.");
      }
    });

    events.onerror = () => {
      pushLog(setLogs, "Live event stream disconnected. Retrying automatically.");
    };

    return () => {
      events.close();
    };
  }, []);

  async function trigger(target: SandboxTarget) {
    setError(null);
    setLoading((current) => ({ ...current, [target]: true }));

    try {
      const response = await runSandbox(target);
      pushLog(setLogs, `Trigger accepted for ${response.target} sandbox.`);
      const [nextRuns, nextStatus] = await Promise.all([getRuns(), getSandboxStatus()]);
      setRuns(nextRuns);
      setStatus(nextStatus);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `Failed to start ${target} sandbox.`);
    } finally {
      setLoading((current) => ({ ...current, [target]: false }));
    }
  }

  return (
    <AppShell activePath="/sandbox">
      <section className="space-y-6 p-6 sm:p-8">
        <div className="mb-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 text-gray-900">Sandbox</h1>
            <p className="text-gray-600">Test and experiment with demo workflows.</p>
          </div>
          <p className="max-w-2xl text-sm text-gray-600">
            Start the local sandbox agents, follow live span events, and open the resulting run details. The real OpenAI flow requires
            `OPENAI_API_KEY` in the API environment.
          </p>
        </div>

        <Card className="border border-black/8 shadow-none ring-0">
          <CardHeader>
            <CardTitle>Quick Start</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-900">
                Select any workflow below to run a demo. The sandbox environment triggers the real local flows and streams span activity
                back into the UI.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="border border-black/8 shadow-none ring-0">
            <CardHeader>
              <CardTitle>Run sandboxes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-1">
                {(["python", "real", "ts"] as SandboxTarget[]).map((target) => {
                  const meta = getTargetDisplay(target);
                  const state = getTargetStatus(target, status, loading[target]);
                  const canRun = !(loading[target] || status?.[target].status === "running");

                  return (
                    <div key={target} className="rounded-lg border border-black/8 bg-white p-5">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold text-gray-900">{meta.name}</div>
                          <p className="mt-1 text-sm text-gray-600">{meta.description}</p>
                        </div>
                        <span className="text-sm text-gray-500">{meta.eta}</span>
                      </div>

                      <div className="mb-4 rounded-lg bg-gray-50 p-3">
                        <div className="flex items-center gap-3">
                          {target === "python" ? (
                            <FlaskConical className="size-4 text-gray-600" />
                          ) : target === "real" ? (
                            <Bot className="size-4 text-gray-600" />
                          ) : (
                            <SquareTerminal className="size-4 text-gray-600" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{formatStatusLine(status?.[target] ?? { status: "idle", pid: null, last_started_at: null, last_finished_at: null, last_exit_code: null, last_error: null, target })}</p>
                            <p className="text-xs text-gray-600">
                              Last start: {status?.[target].last_started_at ? formatDate(status[target].last_started_at) : "Not yet triggered"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <Button
                        onClick={() => void trigger(target)}
                        disabled={!canRun}
                        variant={state === "success" ? "outline" : state === "error" ? "destructive" : "default"}
                        size="sm"
                      >
                        {getStatusIcon(state)}
                        <span>{getStatusText(state)}</span>
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border border-black/8 bg-[linear-gradient(180deg,#111827_0%,#0f172a_100%)] text-white shadow-none ring-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <RadioTower className="size-5 text-cyan-300" />
                Live status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
                <Terminal className="size-4" />
                Span event stream
              </div>
              <div className="h-[260px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-4 text-xs text-slate-200">
                {logs.length > 0 ? (
                  <div className="space-y-2">
                    {logs.map((entry) => (
                      <div key={entry.id}>{entry.message}</div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500">Waiting for sandbox events.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border border-black/8 bg-white shadow-none ring-0">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {sandboxRuns.length > 0 ? (
              <div className="space-y-2">
                {sandboxRuns.map((run) => {
                  const icon =
                    run.status === "running" ? (
                      <Loader2 className="size-5 animate-spin text-blue-600" />
                    ) : run.status === "completed" || run.status === "success" ? (
                      <CheckCircle className="size-5 text-green-600" />
                    ) : run.status === "failed" || run.status === "error" ? (
                      <XCircle className="size-5 text-red-600" />
                    ) : (
                      <PlayCircle className="size-5 text-gray-500" />
                    );

                  return (
                    <div key={run.id} className="flex flex-col gap-3 rounded-lg bg-gray-50 p-3 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-3">
                        {icon}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{run.workflow_name}</p>
                          <p className="text-xs capitalize text-gray-600">
                            {run.status} · {run.agent_name} · {formatDate(run.started_at)}
                          </p>
                        </div>
                      </div>
                      <Button
                        render={<Link href={`/runs/${run.id}`} />}
                        nativeButton={false}
                        variant="outline"
                        size="sm"
                      >
                        Open run
                        <ArrowUpRight className="size-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">No recent activity. Run a workflow to see it here.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
