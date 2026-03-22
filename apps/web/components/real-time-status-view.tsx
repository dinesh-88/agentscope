"use client";

import { useMemo } from "react";

import { type Span } from "@/lib/api";
import { type RunLog } from "@/lib/run-detail-store";
import { cn } from "@/lib/utils";

type RealTimeStatusViewProps = {
  spans: Span[];
  logs: RunLog[];
  selectedSpanId: string | null;
  activeSpanId: string | null;
  className?: string;
};

function formatElapsed(startedAt: string) {
  const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const mins = Math.floor(elapsed / 60_000);
  const secs = Math.floor((elapsed % 60_000) / 1000);
  const centis = Math.floor((elapsed % 1000) / 10);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

export function RealTimeStatusView({
  spans,
  logs,
  selectedSpanId,
  activeSpanId,
  className,
}: RealTimeStatusViewProps) {
  const latestSpans = useMemo(() => [...spans].slice(-3), [spans]);
  const selectedSpan = useMemo(
    () => spans.find((span) => span.id === selectedSpanId) ?? spans[0] ?? null,
    [spans, selectedSpanId],
  );
  const latestLogs = useMemo(() => [...logs].slice(-3), [logs]);
  const totalSpans = spans.length;
  const completedSpans = spans.filter((span) => span.status === "success" || span.status === "completed").length;
  const timelinePercent = totalSpans > 0 ? Math.max(10, Math.round((completedSpans / totalSpans) * 100)) : 10;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 via-slate-900/70 to-blue-500/10 p-4",
        className,
      )}
    >
      <div className="pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-32 w-32 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-white">Real-Time Status View</h3>
          <p className="mt-1 text-xs text-slate-300">Live workflow graph, active timeline, and logs for this run.</p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-200">
            <span className="relative inline-flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
            </span>
            Sub-200ms live updates
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-xl border border-white/10 bg-slate-950/80 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>Workflow Graph</span>
              <span className="text-cyan-300">{activeSpanId ? "running" : "idle"}</span>
            </div>
            <div className="space-y-2">
              {latestSpans.length > 0 ? (
                latestSpans.map((span) => {
                  const isActive = span.id === activeSpanId;
                  const isSelected = span.id === selectedSpanId;
                  const isDone = span.status === "success" || span.status === "completed";
                  const dotClass = isActive
                    ? "bg-amber-400"
                    : isDone
                      ? "bg-emerald-400"
                      : "bg-slate-500";
                  const textClass = isActive
                    ? "text-amber-200"
                    : isSelected
                      ? "text-cyan-200"
                      : isDone
                        ? "text-emerald-200"
                        : "text-slate-300";

                  return (
                    <div key={span.id} className="flex items-center gap-2 rounded bg-slate-900 px-2 py-1.5">
                      <span className={cn("h-2 w-2 rounded-full", dotClass, isActive && "animate-pulse")} />
                      <span className={cn("truncate text-xs", textClass)}>{span.name}</span>
                    </div>
                  );
                })
              ) : (
                <div className="rounded bg-slate-900 px-2 py-1.5 text-xs text-slate-400">No spans yet</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-950/80 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
              <span>Active Span Timeline</span>
              <span className="font-mono text-slate-300">
                {selectedSpan ? formatElapsed(selectedSpan.started_at) : "00:00.00"}
              </span>
            </div>
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded bg-slate-800">
                <div className="h-full rounded bg-cyan-400/80 transition-all duration-300" style={{ width: `${timelinePercent}%` }} />
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-800">
                <div
                  className={cn(
                    "h-full rounded transition-all duration-300",
                    activeSpanId ? "w-2/3 animate-pulse bg-amber-400/80" : "w-1/2 bg-emerald-400/70",
                  )}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-950/80 p-3">
            <div className="mb-2 text-xs text-slate-400">Live Logs</div>
            <div className="space-y-1.5 font-mono text-[11px]">
              {latestLogs.length > 0 ? (
                latestLogs.map((log) => (
                  <p key={log.id} className="truncate text-slate-300">
                    [{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--:--:--"}] {log.message}
                  </p>
                ))
              ) : (
                <p className="text-slate-500">No logs yet</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
