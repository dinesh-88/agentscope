"use client";

import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, ArrowDown, CheckCircle2, Loader2 } from "lucide-react";

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
  highlightedTransitionToSpanId?: string | null;
  highlightedSpanId?: string | null;
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
  className,
  selectedSpanId,
  hoveredSpanId,
  onSpanSelect,
  onSpanHover,
  highlightedTransitionToSpanId,
  highlightedSpanId,
}: TraceViewProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const transitionRefs = useRef(new Map<string, HTMLDivElement | null>());

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

  useEffect(() => {
    if (!highlightedTransitionToSpanId) return;
    const el = transitionRefs.current.get(highlightedTransitionToSpanId);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightedTransitionToSpanId]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-slate-900">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Span Timeline</p>
        <div className="space-y-2">
          {rows.map((span, index) => {
            const leftPct = (span.startMs / maxEndMs) * 100;
            const widthPct = Math.max((span.durationMs / maxEndMs) * 100, 2);
            const isSelected = selectedSpanId === span.id;
            const isHovered = hoveredSpanId === span.id;
            const isTransitionLinked = highlightedTransitionToSpanId === span.id;
            const isSpanLinked = highlightedSpanId === span.id;
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
            const transitionPairLabel = prevSpan
              ? `${prevSpan.name} -> ${span.name}`
              : span.name;

            return (
              <div key={span.id} className="space-y-2">
                <div
                  id={`span-${span.id}`}
                  ref={(node) => {
                    rowRefs.current.set(span.id, node);
                    transitionRefs.current.set(span.id, node);
                  }}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "cursor-pointer rounded-lg border p-2 transition",
                    isSelected
                      ? "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/15"
                      : "border-black/10 bg-white hover:bg-neutral-50 dark:border-white/10 dark:bg-slate-900 dark:hover:bg-slate-800/70",
                    isHovered && !isSelected ? "border-blue-200 dark:border-blue-500/35" : undefined,
                    isSpanLinked ? "ring-2 ring-blue-300 ring-offset-2 ring-offset-white dark:ring-blue-500/50 dark:ring-offset-slate-900" : undefined,
                  )}
                  onClick={() => onSpanSelect?.(span.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSpanSelect?.(span.id);
                    }
                  }}
                  onMouseEnter={() => onSpanHover?.(span.id)}
                  onMouseLeave={() => onSpanHover?.(null)}
                >
                  <div className="relative h-5 overflow-hidden rounded bg-neutral-100 dark:bg-slate-800">
                    <div className="absolute inset-y-0" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                      <div className={cn("flex h-full items-center justify-end rounded pr-1 text-[10px] font-medium text-white/90", barTone(span, isSelected, isHovered))}>
                        {formatMs(span.durationMs)}
                      </div>
                    </div>
                  </div>
                </div>

                {isSelected ? (
                  <div className="space-y-2 rounded-lg border border-black/10 bg-neutral-50 p-3 text-xs dark:border-white/10 dark:bg-slate-800/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{span.name}</p>
                        <p className="mt-1 text-neutral-500 dark:text-neutral-400">
                          Step {index + 1} • {span.spanType ?? "span"}
                        </p>
                      </div>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", statusBadgeTone(span.status))}>
                        <SpanStatusIcon className={cn("size-3", span.status === "running" ? "animate-spin" : undefined)} />
                        {span.status}
                      </span>
                    </div>

                    {index > 0 ? (
                      <div className="rounded-md border border-black/10 bg-white p-2 dark:border-white/10 dark:bg-slate-900/70">
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          <span className="font-medium text-neutral-700 dark:text-neutral-200">{prevSpan?.name}</span>
                          <ArrowDown className="mx-1 inline size-3 align-middle text-neutral-400 dark:text-neutral-500" />
                          <span className="font-medium text-neutral-700 dark:text-neutral-200">{span.name}</span>
                        </div>
                        {hasMeaningfulChanges ? (
                          <ul className="mt-2 space-y-1 text-neutral-700 dark:text-neutral-300">
                            {summaryItems.shown.map((item) => (
                              <li key={item}>+ {item}</li>
                            ))}
                            {summaryItems.overflow > 0 ? <li className="text-neutral-500 dark:text-neutral-400">+{summaryItems.overflow} more changes</li> : null}
                          </ul>
                        ) : (
                          <p className="mt-2 text-neutral-500 dark:text-neutral-400">No significant transition changes</p>
                        )}
                      </div>
                    ) : null}

                    {transition?.likely_cause ? (
                      <div className={cn(
                        "rounded-md border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200",
                        isTransitionLinked ? "ring-2 ring-blue-300 dark:ring-blue-500/50" : undefined,
                      )}>
                        <p className="font-semibold">Likely contributed to failure</p>
                        <p className="mt-1">{transition.cause_reason ?? "A transition change likely contributed to this failure"}</p>
                      </div>
                    ) : null}

                    <p className="text-neutral-500 dark:text-neutral-400">{transitionPairLabel}</p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
