"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ArrowDown, CheckCircle2, Circle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type TraceSpan = {
  id: string;
  name: string;
  parentId?: string;
  spanType?: string;
  startMs: number;
  durationMs: number;
  status: "success" | "running" | "error";
  prompt: string;
  response: string;
  tokens: number;
  latencyMs: number;
  contextUsagePercent?: number | null;
  stepTransition?: {
    from_span_id: string;
    to_span_id: string;
    messages_added: number;
    messages_removed: number;
    added_messages: string[];
    removed_messages: string[];
    token_delta: number;
    tool_output_added: boolean;
    tool_outputs_added: string[];
    instruction_changed: boolean;
    instruction_changes: string[];
    warnings: string[];
    likely_cause: boolean;
    cause_confidence: number;
    cause_reason?: string | null;
  } | null;
  rca?: {
    summary: string;
    rootCause: string;
    location: string;
    suggestedFix: string;
    confidence?: number;
  };
};

type TraceViewProps = {
  spans: TraceSpan[];
  title?: string;
  className?: string;
  selectedSpanId?: string | null;
  hoveredSpanId?: string | null;
  onSpanSelect?: (spanId: string) => void;
  onSpanHover?: (spanId: string | null) => void;
  totalDurationMs?: number;
  totalTokens?: number;
  model?: string;
};

type EnrichedSpan = TraceSpan & {
  depth: number;
  ancestors: string[];
};

function formatMs(value: number) {
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function compact(values: string[], maxItems: number = 4) {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  return {
    shown: cleaned.slice(0, maxItems),
    overflow: Math.max(cleaned.length - maxItems, 0),
  };
}

function statusBadgeTone(status: TraceSpan["status"]) {
  if (status === "error") return "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200";
  if (status === "running") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200";
  return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200";
}

function statusIcon(status: TraceSpan["status"]) {
  if (status === "error") return AlertTriangle;
  if (status === "running") return Loader2;
  return CheckCircle2;
}

function barTone(span: TraceSpan, selected: boolean, hovered: boolean) {
  if (selected) return "bg-blue-500";
  if (span.status === "error") return "bg-red-500";
  if (hovered) return "bg-blue-400";
  if ((span.spanType ?? "").toLowerCase().includes("tool")) return "bg-amber-500";
  if ((span.spanType ?? "").toLowerCase().includes("llm")) return "bg-sky-500";
  return "bg-slate-500";
}

export function TraceView({
  spans,
  title,
  className,
  selectedSpanId,
  hoveredSpanId,
  onSpanSelect,
  onSpanHover,
  totalDurationMs,
  totalTokens,
  model,
}: TraceViewProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());

  const { rows, maxEndMs } = useMemo(() => {
    const byId = new Map(spans.map((span) => [span.id, span]));
    const depthMemo = new Map<string, number>();

    const getDepth = (span: TraceSpan, visited = new Set<string>()): number => {
      if (depthMemo.has(span.id)) return depthMemo.get(span.id)!;
      if (!span.parentId || !byId.has(span.parentId)) {
        depthMemo.set(span.id, 0);
        return 0;
      }
      if (visited.has(span.id)) return 0;
      visited.add(span.id);
      const parent = byId.get(span.parentId)!;
      const depth = getDepth(parent, visited) + 1;
      depthMemo.set(span.id, depth);
      return depth;
    };

    const enriched: EnrichedSpan[] = spans.map((span) => {
      const depth = getDepth(span);
      const ancestors: string[] = [];
      let cursor = span.parentId;
      while (cursor && byId.has(cursor)) {
        ancestors.push(cursor);
        cursor = byId.get(cursor)?.parentId;
      }
      return { ...span, depth, ancestors };
    });

    const sorted = [...enriched].sort((a, b) => {
      const startDelta = a.startMs - b.startMs;
      if (startDelta !== 0) return startDelta;
      const depthDelta = a.depth - b.depth;
      if (depthDelta !== 0) return depthDelta;
      return a.id.localeCompare(b.id);
    });

    return {
      rows: sorted,
      maxEndMs: Math.max(...sorted.map((span) => span.startMs + span.durationMs), 1),
    };
  }, [spans]);

  useEffect(() => {
    if (!selectedSpanId) return;
    const el = rowRefs.current.get(selectedSpanId);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [selectedSpanId]);

  const runDuration = totalDurationMs ?? maxEndMs;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title ?? "Timeline Header"}</p>
        <div className="mt-2 grid gap-2 text-sm text-neutral-700 dark:text-neutral-300 sm:grid-cols-3">
          <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-slate-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Total duration</p>
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{formatMs(runDuration)}</p>
          </div>
          <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-slate-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Token usage</p>
            <p className="font-medium text-neutral-900 dark:text-neutral-100">{(totalTokens ?? spans.reduce((sum, span) => sum + (span.tokens ?? 0), 0)).toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-slate-800">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Model</p>
            <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">{model ?? "n/a"}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Span Timeline</p>
        <div className="space-y-2">
          {rows.map((span, index) => {
            const leftPct = (span.startMs / maxEndMs) * 100;
            const widthPct = Math.max((span.durationMs / maxEndMs) * 100, 2);
            const isSelected = selectedSpanId === span.id;
            const isHovered = hoveredSpanId === span.id;
            const transition = span.stepTransition;
            const prevSpan = rows[index - 1] ?? null;
            const tokenDelta = transition?.token_delta ?? 0;
            const summaryItems = compact(
              [
                transition?.tool_output_added ? "Tool output added" : "",
                tokenDelta !== 0
                  ? `Context ${tokenDelta > 0 ? "+" : ""}${tokenDelta} tokens`
                  : "",
                (transition?.messages_added ?? 0) > 0
                  ? `${transition?.messages_added ?? 0} messages added`
                  : "",
              ].filter(Boolean),
              3,
            );
            const SpanStatusIcon = statusIcon(span.status);
            const hasMeaningfulChanges = summaryItems.shown.length > 0;

            return (
              <div key={span.id} className="space-y-2">
                {index > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSpanSelect?.(span.id)}
                    onMouseEnter={() => onSpanHover?.(span.id)}
                    onMouseLeave={() => onSpanHover?.(null)}
                    className={cn(
                      "my-2 w-full space-y-2 rounded-lg border bg-neutral-50 p-3 text-left shadow-sm transition-all hover:-translate-y-[1px] hover:shadow dark:bg-slate-800/70",
                      transition?.likely_cause
                        ? "border-l-4 border-red-400 border-red-200 bg-red-50/40 dark:border-red-500/40 dark:bg-red-500/10"
                        : "border-black/10 dark:border-white/10",
                    )}
                  >
                    <div className="text-xs text-neutral-500 dark:text-neutral-400">
                      <span className="font-medium text-neutral-700 dark:text-neutral-200">{prevSpan?.name}</span>
                      <ArrowDown className="mx-1 inline size-3 align-middle text-neutral-400 dark:text-neutral-500" />
                      <span className="font-medium text-neutral-700 dark:text-neutral-200">{span.name}</span>
                    </div>
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Changes after this step</p>
                    {hasMeaningfulChanges ? (
                      <ul className="space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                        {summaryItems.shown.map((item) => (
                          <li key={item}>+ {item}</li>
                        ))}
                        {summaryItems.overflow > 0 ? <li className="text-neutral-500 dark:text-neutral-400">+{summaryItems.overflow} more changes</li> : null}
                      </ul>
                    ) : (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">No significant changes</p>
                    )}
                    {transition?.likely_cause ? (
                      <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200">
                        <p className="font-semibold">Likely contributed to failure</p>
                        <p className="mt-1">{transition.cause_reason ?? "A transition change likely contributed to this failure"}</p>
                      </div>
                    ) : null}
                  </button>
                ) : null}

                <div
                  id={`span-${span.id}`}
                  ref={(node) => {
                    rowRefs.current.set(span.id, node);
                  }}
                  className={cn(
                    "grid cursor-pointer items-center gap-3 rounded-lg border p-3 transition",
                    isSelected
                      ? "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/15"
                      : "border-black/10 bg-white hover:bg-neutral-50 dark:border-white/10 dark:bg-slate-900 dark:hover:bg-slate-800/70",
                    isHovered && !isSelected ? "border-blue-200 dark:border-blue-500/35" : undefined,
                  )}
                  onClick={() => onSpanSelect?.(span.id)}
                  onMouseEnter={() => onSpanHover?.(span.id)}
                  onMouseLeave={() => onSpanHover?.(null)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${span.depth * 14}px` }}>
                      <Circle className="size-3 text-neutral-400 dark:text-neutral-500" />
                      <p className={cn("truncate text-sm", span.status === "error" ? "font-semibold text-red-700 dark:text-red-300" : "font-medium text-neutral-900 dark:text-neutral-100")}>
                        {span.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", statusBadgeTone(span.status))}>
                        <SpanStatusIcon className={cn("size-3", span.status === "running" ? "animate-spin" : undefined)} />
                        {span.status}
                      </span>
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatMs(span.durationMs)}</span>
                    </div>
                  </div>

                  <div className="relative h-3 overflow-hidden rounded bg-neutral-100 dark:bg-slate-800">
                    <div className="absolute inset-y-0" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                      <div className={cn("h-full rounded", barTone(span, isSelected, isHovered))} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
