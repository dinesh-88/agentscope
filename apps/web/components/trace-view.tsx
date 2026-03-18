"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type MouseEvent, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type TraceSpan = {
  id: string;
  name: string;
  parentId?: string;
  startMs: number;
  durationMs: number;
  status: "success" | "running" | "error";
  prompt: string;
  response: string;
  tokens: number;
  latencyMs: number;
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
  title?: string;
  selectedSpanId?: string | null;
  onSpanSelect?: (spanId: string) => void;
};

type EnrichedSpan = TraceSpan & {
  depth: number;
  ancestors: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function TraceView({ spans, className, title = "Run Trace", selectedSpanId, onSpanSelect }: TraceViewProps) {
  const shouldReduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<{ span: TraceSpan; x: number; y: number } | null>(null);
  const [openRcaSpanId, setOpenRcaSpanId] = useState<string | null>(null);

  const { rows, maxEndMs, maxDurationMs } = useMemo(() => {
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

    const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);
    const enriched: EnrichedSpan[] = sorted.map((span) => {
      const depth = getDepth(span);
      const ancestors: string[] = [];
      let cursor = span.parentId;
      while (cursor && byId.has(cursor)) {
        ancestors.push(cursor);
        cursor = byId.get(cursor)?.parentId;
      }
      return { ...span, depth, ancestors };
    });

    return {
      rows: enriched,
      maxEndMs: Math.max(...enriched.map((span) => span.startMs + span.durationMs), 1),
      maxDurationMs: Math.max(...enriched.map((span) => span.durationMs), 1),
    };
  }, [spans]);

  const handleHover = (event: MouseEvent<HTMLDivElement>, span: TraceSpan) => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setTooltip({ span, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const axisTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }).map((_, i) => {
      const ratio = i / steps;
      return { ratio, label: `${Math.round(maxEndMs * ratio)}ms` };
    });
  }, [maxEndMs]);

  const focusPath = useMemo(() => {
    if (!openRcaSpanId) return null;
    const byId = new Map(rows.map((span) => [span.id, span]));
    const openSpan = byId.get(openRcaSpanId);
    if (!openSpan) return null;

    const path = new Set<string>([openSpan.id, ...openSpan.ancestors]);
    for (const span of rows) {
      if (span.ancestors.includes(openSpan.id)) path.add(span.id);
    }
    return path;
  }, [rows, openRcaSpanId]);

  const getRca = (span: TraceSpan) => {
    if (span.rca) return span.rca;
    return {
      summary: "Failure detected during span execution.",
      rootCause: span.response || "A dependency/tool call failed during execution.",
      location: span.name,
      suggestedFix: "Validate inputs and credentials, add retries, and add fallback behavior for this step.",
    };
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/10 bg-[#0B0F14] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.35)]",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        <span className="text-xs text-slate-500">{maxEndMs}ms total</span>
      </div>

      <div className="grid grid-cols-[280px_minmax(0,1fr)] items-end gap-3 px-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">
        <div>Span</div>
        <div>Timeline</div>
      </div>
      <div className="mt-2 grid grid-cols-[280px_minmax(0,1fr)] gap-3">
        <div />
        <div className="relative h-10 rounded-md bg-[#0F1620]">
          {axisTicks.map((tick) => (
            <div key={tick.label} className="absolute inset-y-1" style={{ left: `${tick.ratio * 100}%` }}>
              <div className="absolute -translate-x-1/2 text-[10px] text-slate-500">{tick.label}</div>
              <div className="absolute bottom-0 top-4 w-px bg-slate-700/60" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {rows.map((span, index) => {
          const leftPct = (span.startMs / maxEndMs) * 100;
          const widthPct = Math.max((span.durationMs / maxEndMs) * 100, 1.8);
          const rowBarLeft = `calc(${leftPct}% + 8px)`;
          const rowBarWidth = `calc(${widthPct}% - 6px)`;
          const fillDuration = 0.45 + (span.durationMs / maxDurationMs) * 1.2;
          const revealDelay = shouldReduceMotion ? 0 : index * 0.09;
          const isRunning = span.status === "running";
          const isError = span.status === "error";
          const isSelected = selectedSpanId === span.id;
          const isRcaOpen = openRcaSpanId === span.id;
          const isDimmed = Boolean(openRcaSpanId && focusPath && !focusPath.has(span.id));
          const rca = getRca(span);

          return (
            <div key={span.id}>
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: isDimmed ? 0.38 : 1, y: 0 }}
                transition={{ duration: 0.28, delay: revealDelay, ease: "easeOut" }}
                className={cn("grid grid-cols-[280px_minmax(0,1fr)] items-center gap-3", onSpanSelect ? "cursor-pointer" : undefined)}
                onClick={onSpanSelect ? () => onSpanSelect(span.id) : undefined}
              >
                <div className="relative h-9 rounded-md bg-[#101722] px-2 py-1.5">
                  {Array.from({ length: span.depth }).map((_, guideIndex) => (
                    <span
                      key={`${span.id}-guide-${guideIndex}`}
                      className={cn(
                        "absolute top-1/2 h-4 w-px -translate-y-1/2",
                        focusPath?.has(span.id) ? "bg-amber-300/45" : "bg-slate-600/80",
                      )}
                      style={{ left: 12 + guideIndex * 10 }}
                    />
                  ))}
                  {span.depth > 0 && (
                    <span
                      className={cn("absolute h-px", focusPath?.has(span.id) ? "bg-amber-300/45" : "bg-slate-600/80")}
                      style={{ left: 12 + (span.depth - 1) * 10, top: "50%", width: 8 }}
                    />
                  )}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 truncate font-mono text-[11px] text-slate-200"
                    style={{ left: 24 + span.depth * 10, right: 12 }}
                  >
                    {span.name}
                  </div>
                </div>

                <div className="relative h-9 rounded-md bg-[#101722] px-2 py-1.5">
                  <div className="absolute inset-y-1.5 left-2 right-2 rounded bg-[#0F1620]" />
                  <motion.div
                    className={cn(
                      "absolute inset-y-1.5 rounded-md border",
                      isSelected
                        ? "border-blue-300/80 bg-blue-500/16"
                        : isError
                          ? "border-red-500/65 bg-red-500/12"
                          : isRunning
                            ? "border-blue-400/65 bg-blue-500/15"
                            : "border-slate-600/70 bg-slate-500/12",
                    )}
                    style={{ left: rowBarLeft, width: rowBarWidth }}
                    animate={
                      shouldReduceMotion
                        ? undefined
                        : isError
                          ? {
                              boxShadow: [
                                "0 0 0 rgba(239,68,68,0)",
                                "0 0 16px rgba(239,68,68,0.26)",
                                "0 0 0 rgba(239,68,68,0)",
                              ],
                            }
                          : isRunning
                            ? {
                                boxShadow: [
                                  "0 0 0 rgba(96,165,250,0)",
                                  "0 0 18px rgba(96,165,250,0.24)",
                                  "0 0 0 rgba(96,165,250,0)",
                                ],
                              }
                            : undefined
                    }
                    transition={
                      shouldReduceMotion
                        ? undefined
                        : isError
                          ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                          : isRunning
                            ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
                            : undefined
                    }
                    onMouseEnter={(event) => handleHover(event, span)}
                    onMouseMove={(event) => handleHover(event, span)}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <motion.div
                      className={cn(
                        "h-full rounded-md",
                        isSelected
                          ? "bg-gradient-to-r from-indigo-400/80 to-blue-300/90"
                          : isError
                            ? "bg-gradient-to-r from-red-500/70 to-red-400/80"
                            : isRunning
                              ? "bg-gradient-to-r from-purple-500/80 to-blue-400/85"
                              : "bg-gradient-to-r from-violet-500/70 to-blue-500/75",
                      )}
                      initial={shouldReduceMotion ? false : { width: 0, opacity: 0.85 }}
                      animate={{ width: "100%", opacity: 1 }}
                      transition={{ duration: fillDuration, delay: revealDelay + 0.06, ease: "easeOut" }}
                    />
                  </motion.div>

                  {isError && (
                    <button
                      type="button"
                      className={cn(
                        "absolute right-16 top-1/2 -translate-y-1/2 rounded border px-1.5 py-0.5 text-[10px] font-medium transition",
                        isRcaOpen
                          ? "border-amber-300/70 bg-amber-400/20 text-amber-200"
                          : "border-amber-400/45 bg-amber-500/15 text-amber-300 hover:bg-amber-500/22",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSpanSelect?.(span.id);
                        setOpenRcaSpanId((current) => (current === span.id ? null : span.id));
                      }}
                    >
                      ⚠ RCA
                    </button>
                  )}

                  <div className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-400">{span.durationMs}ms</div>
                </div>
              </motion.div>

              <AnimatePresence initial={false}>
                {isRcaOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    className="grid grid-cols-[280px_minmax(0,1fr)] gap-3 overflow-hidden pt-1"
                  >
                    <div />
                    <motion.div
                      initial={{ y: 6, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 4, opacity: 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="rounded-lg border border-amber-400/35 bg-amber-500/8 p-3 text-xs"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-medium text-amber-200">Root Cause Analysis</span>
                        {typeof rca.confidence === "number" && (
                          <span className="text-[11px] text-amber-300/90">confidence {Math.round(rca.confidence * 100)}%</span>
                        )}
                      </div>
                      <div className="space-y-2 text-slate-200">
                        <div>
                          <span className="text-amber-300">Failure:</span> {rca.summary}
                        </div>
                        <div>
                          <span className="text-amber-300">Root cause:</span> {rca.rootCause}
                        </div>
                        <div>
                          <span className="text-amber-300">Location:</span> {rca.location}
                        </div>
                        <div>
                          <span className="text-amber-300">Suggested fix:</span> {rca.suggestedFix}
                        </div>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {tooltip && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="pointer-events-none absolute z-20 w-80 rounded-lg border border-slate-600/60 bg-[#0E1520]/95 p-3 text-xs text-slate-200 shadow-[0_20px_48px_rgba(0,0,0,0.45)]"
            style={{ left: clamp(tooltip.x + 14, 12, 940), top: clamp(tooltip.y - 18, 10, 420) }}
          >
            <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-slate-400">{tooltip.span.name}</div>
            <div className="space-y-1.5">
              <div>
                <span className="text-slate-500">prompt:</span> {tooltip.span.prompt}
              </div>
              <div>
                <span className="text-slate-500">response:</span> {tooltip.span.response}
              </div>
              <div className="flex gap-3 text-slate-300">
                <span>
                  <span className="text-slate-500">tokens:</span> {tooltip.span.tokens}
                </span>
                <span>
                  <span className="text-slate-500">latency:</span> {tooltip.span.latencyMs}ms
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
