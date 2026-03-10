"use client";

import { useEffect, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Network, Workflow } from "lucide-react";

import { type Span } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRunDetailStore } from "@/lib/run-detail-store";

type SpanTreeProps = {
  spans: Span[];
};

type DecoratedSpan = Span & {
  level: number;
};

function buildTree(spans: Span[]): DecoratedSpan[] {
  const byParent = new Map<string | null, Span[]>();

  for (const span of spans) {
    const bucket = byParent.get(span.parent_span_id ?? null) ?? [];
    bucket.push(span);
    byParent.set(span.parent_span_id ?? null, bucket);
  }

  const ordered: DecoratedSpan[] = [];

  function walk(parentId: string | null, level: number) {
    for (const span of byParent.get(parentId) ?? []) {
      ordered.push({ ...span, level });
      walk(span.id, level + 1);
    }
  }

  walk(null, 0);
  return ordered;
}

export function SpanTree({ spans }: SpanTreeProps) {
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const setSelectedSpanId = useRunDetailStore((state) => state.setSelectedSpanId);
  const orderedSpans = useMemo(() => buildTree(spans), [spans]);

  useEffect(() => {
    if (!selectedSpanId && orderedSpans[0]) {
      setSelectedSpanId(orderedSpans[0].id);
    }
  }, [orderedSpans, selectedSpanId, setSelectedSpanId]);

  const chartData = orderedSpans
    .filter((span) => (span.input_tokens ?? 0) > 0 || (span.output_tokens ?? 0) > 0)
    .map((span) => ({
      name: span.name,
      input: span.input_tokens ?? 0,
      output: span.output_tokens ?? 0,
    }));

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-900">
          <Workflow className="size-4 text-cyan-600" />
          Span tree
        </div>
        <div className="space-y-2">
          {orderedSpans.map((span) => (
            <button
              key={span.id}
              type="button"
              onClick={() => setSelectedSpanId(span.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
                selectedSpanId === span.id
                  ? "border-cyan-300 bg-cyan-50"
                  : "border-slate-200/80 bg-slate-50/70 hover:border-slate-300 hover:bg-white",
              )}
              style={{ paddingLeft: `${span.level * 18 + 16}px` }}
            >
              <div className="flex items-center gap-3">
                <ChevronRight className={cn("size-4 text-slate-400", span.level === 0 && "text-cyan-600")} />
                <div>
                  <div className="font-medium text-slate-950">{span.name}</div>
                  <div className="text-xs text-slate-500">
                    {span.span_type} · {span.provider ?? "n/a"} · {span.model ?? "unresolved"}
                  </div>
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>{span.status}</div>
                <div>{span.total_tokens ?? 0} tokens</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-900">
          <Network className="size-4 text-amber-600" />
          Token distribution
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="4 4" stroke="#dbe4ee" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar dataKey="input" fill="#0f766e" radius={[6, 6, 0, 0]} />
              <Bar dataKey="output" fill="#f59e0b" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
