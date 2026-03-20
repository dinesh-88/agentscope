"use client";

import { useMemo } from "react";

import type { Span } from "@/lib/api";
import { cn } from "@/lib/utils";

type WorkflowGraphProps = {
  spans: Span[];
  activeSpanId: string | null;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
};

function spanState(span: Span): "pending" | "running" | "success" | "error" {
  if (span.status === "running" || span.status === "pending") return "running";
  if (span.status === "success" || span.status === "completed" || span.status === "ok") return "success";
  if (span.status === "failed" || span.status === "error") return "error";
  return "pending";
}

const toneByState: Record<ReturnType<typeof spanState>, string> = {
  pending: "bg-slate-200 text-slate-700",
  running: "bg-amber-200 text-amber-900 animate-pulse",
  success: "bg-emerald-200 text-emerald-900",
  error: "bg-red-200 text-red-900",
};

export function WorkflowGraph({ spans, activeSpanId, selectedSpanId, onSelectSpan }: WorkflowGraphProps) {
  const nodes = useMemo(() => {
    const byParent = new Map<string | null, Span[]>();
    for (const span of spans) {
      const key = span.parent_span_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(span);
    }

    const ordered: Array<{ span: Span; depth: number }> = [];
    const roots = [...(byParent.get(null) ?? [])].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at));
    const queue = roots.map((span) => ({ span, depth: 0 }));

    while (queue.length > 0) {
      const current = queue.shift()!;
      ordered.push(current);
      const children = [...(byParent.get(current.span.id) ?? [])].sort(
        (a, b) => +new Date(a.started_at) - +new Date(b.started_at),
      );
      for (const child of children) {
        queue.push({ span: child, depth: current.depth + 1 });
      }
    }

    return ordered;
  }, [spans]);

  return (
    <div className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
      {nodes.length === 0 ? (
        <p className="text-sm text-neutral-500">No spans yet.</p>
      ) : (
        nodes.map(({ span, depth }) => {
          const state = spanState(span);
          const isSelected = selectedSpanId === span.id;
          const isActive = activeSpanId === span.id;
          return (
            <button
              key={span.id}
              type="button"
              onClick={() => onSelectSpan(span.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-slate-50",
                isSelected && "ring-1 ring-blue-400",
              )}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
            >
              <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", toneByState[state])}>
                {state}
              </span>
              <span className="truncate font-medium text-neutral-900">{span.name}</span>
              {isActive ? <span className="ml-auto text-xs text-amber-700">active</span> : null}
            </button>
          );
        })
      )}
    </div>
  );
}

