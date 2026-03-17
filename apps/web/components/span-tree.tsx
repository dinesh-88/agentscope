"use client";

import { useEffect, useMemo } from "react";
import { ChevronRight, GitBranch, Timer } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="size-4 text-blue-600" />
          Span Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {orderedSpans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/10 bg-neutral-50 p-6 text-sm text-neutral-500">
            No spans were captured for this run.
          </div>
        ) : (
          orderedSpans.map((span) => (
            <button
              key={span.id}
              type="button"
              onClick={() => setSelectedSpanId(span.id)}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition",
                selectedSpanId === span.id
                  ? "border-blue-400 bg-blue-50"
                  : "border-black/8 bg-neutral-50 hover:border-neutral-300 hover:bg-white",
              )}
              style={{ paddingLeft: `${span.level * 18 + 16}px` }}
            >
              <div className="flex items-center gap-3">
                <ChevronRight className={cn("size-4 text-neutral-400", span.level === 0 && "text-blue-600")} />
                <div>
                  <div className="font-medium text-neutral-950">{span.name}</div>
                  <div className="text-xs text-neutral-500">
                    {span.span_type} · {span.provider ?? "n/a"} · {span.model ?? "unresolved"}
                  </div>
                </div>
              </div>
              <div className="text-right text-xs text-neutral-500">
                <div>{span.status}</div>
                <div className="inline-flex items-center gap-1">
                  <Timer className="size-3" />
                  {span.total_tokens ?? 0} tokens
                </div>
              </div>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
}
