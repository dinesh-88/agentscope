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
    added_messages: string[];
    removed_messages: string[];
    token_delta: number;
    tool_outputs_added: string[];
    instruction_changes: string[];
    warnings: string[];
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

function normalizeWarning(value: string) {
  if (value === "context_size_high") return "Context nearing limit";
  if (value === "context_truncated") return "Context was truncated";
  if (value === "missing_validation") return "No validation before next step";
  return value;
}

function statusBadgeTone(status: TraceSpan["status"]) {
  if (status === "error") return "border-red-300 bg-red-50 text-red-700";
  if (status === "running") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-emerald-300 bg-emerald-50 text-emerald-700";
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
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-neutral-900">Timeline Header</p>
        <div className="mt-2 grid gap-2 text-sm text-neutral-700 sm:grid-cols-3">
          <div className="rounded-lg bg-neutral-50 px-3 py-2">
            <p className="text-xs text-neutral-500">Total duration</p>
            <p className="font-medium text-neutral-900">{formatMs(runDuration)}</p>
          </div>
          <div className="rounded-lg bg-neutral-50 px-3 py-2">
            <p className="text-xs text-neutral-500">Token usage</p>
            <p className="font-medium text-neutral-900">{(totalTokens ?? spans.reduce((sum, span) => sum + (span.tokens ?? 0), 0)).toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-neutral-50 px-3 py-2">
            <p className="text-xs text-neutral-500">Model</p>
            <p className="truncate font-medium text-neutral-900">{model ?? "n/a"}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-black/10 bg-white p-4">
        <p className="text-sm font-semibold text-neutral-900">Span Timeline</p>
        <div className="space-y-2">
          {rows.map((span, index) => {
            const leftPct = (span.startMs / maxEndMs) * 100;
            const widthPct = Math.max((span.durationMs / maxEndMs) * 100, 2);
            const isSelected = selectedSpanId === span.id;
            const isHovered = hoveredSpanId === span.id;
            const transition = span.stepTransition;
            const prevSpan = rows[index - 1] ?? null;
            const addedItems = compact([...(transition?.tool_outputs_added ?? []), ...(transition?.added_messages ?? [])]);
            const removedItems = compact(transition?.removed_messages ?? []);
            const warningItems = compact((transition?.warnings ?? []).map(normalizeWarning));
            const instructionItems = compact(transition?.instruction_changes ?? []);
            const SpanStatusIcon = statusIcon(span.status);

            return (
              <div key={span.id} className="space-y-2">
                {index > 0 ? (
                  <div className="space-y-1 rounded-lg border border-black/10 bg-neutral-50 p-3 transition-shadow hover:shadow-sm">
                    <div className="text-xs text-neutral-500">
                      <span className="font-medium text-neutral-700">{prevSpan?.name}</span>
                      <ArrowDown className="mx-1 inline size-3 align-middle text-neutral-400" />
                      <span className="font-medium text-neutral-700">{span.name}</span>
                    </div>
                    <p className="text-sm font-semibold text-neutral-900">Changes after this step</p>
                    <div className="grid gap-2 text-xs text-neutral-700 sm:grid-cols-2">
                      <div className="rounded-md bg-white p-2">
                        <p className="font-medium text-emerald-700">+ Added</p>
                        {addedItems.shown.length > 0 ? (
                          <ul className="mt-1 space-y-1">
                            {addedItems.shown.map((item) => (
                              <li key={item} className="truncate">{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-neutral-500">No additions</p>
                        )}
                        {addedItems.overflow > 0 ? (
                          <details className="mt-1 text-neutral-500">
                            <summary className="cursor-pointer">+{addedItems.overflow} more</summary>
                          </details>
                        ) : null}
                      </div>
                      <div className="rounded-md bg-white p-2">
                        <p className="font-medium text-red-700">- Removed</p>
                        {removedItems.shown.length > 0 ? (
                          <ul className="mt-1 space-y-1">
                            {removedItems.shown.map((item) => (
                              <li key={item} className="truncate">{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1 text-neutral-500">No removals</p>
                        )}
                        {removedItems.overflow > 0 ? (
                          <details className="mt-1 text-neutral-500">
                            <summary className="cursor-pointer">+{removedItems.overflow} more</summary>
                          </details>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                      <span className="rounded bg-white px-2 py-1">Token delta: {(transition?.token_delta ?? 0) >= 0 ? "+" : ""}{transition?.token_delta ?? 0}</span>
                      <span className="rounded bg-white px-2 py-1">Context usage: {typeof span.contextUsagePercent === "number" ? `${span.contextUsagePercent.toFixed(0)}%` : "n/a"}</span>
                    </div>
                    {instructionItems.shown.length > 0 ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <p className="font-medium">Instruction changes</p>
                        <ul className="mt-1 space-y-1">
                          {instructionItems.shown.map((item) => (
                            <li key={item} className="truncate">{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {warningItems.shown.length > 0 ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        <p className="font-medium">Warnings</p>
                        <ul className="mt-1 space-y-1">
                          {warningItems.shown.map((item) => (
                            <li key={item}>⚠ {item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div
                  ref={(node) => {
                    rowRefs.current.set(span.id, node);
                  }}
                  className={cn(
                    "grid cursor-pointer items-center gap-3 rounded-lg border p-3 transition",
                    isSelected ? "border-blue-300 bg-blue-50" : "border-black/10 bg-white hover:bg-neutral-50",
                    isHovered && !isSelected ? "border-blue-200" : undefined,
                  )}
                  onClick={() => onSpanSelect?.(span.id)}
                  onMouseEnter={() => onSpanHover?.(span.id)}
                  onMouseLeave={() => onSpanHover?.(null)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${span.depth * 14}px` }}>
                      <Circle className="size-3 text-neutral-400" />
                      <p className={cn("truncate text-sm", span.status === "error" ? "font-semibold text-red-700" : "font-medium text-neutral-900")}>
                        {span.name}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", statusBadgeTone(span.status))}>
                        <SpanStatusIcon className={cn("size-3", span.status === "running" ? "animate-spin" : undefined)} />
                        {span.status}
                      </span>
                      <span className="text-xs text-neutral-500">{formatMs(span.durationMs)}</span>
                    </div>
                  </div>

                  <div className="relative h-3 overflow-hidden rounded bg-neutral-100">
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
