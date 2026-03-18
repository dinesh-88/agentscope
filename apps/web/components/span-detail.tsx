"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";

type SpanDetailProps = {
  spans: Span[];
};

function formatLatency(startedAt: string, endedAt: string | null) {
  if (!endedAt) return "Running";
  const delta = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return `${Math.max(delta, 0)} ms`;
}

export function SpanDetail({ spans }: SpanDetailProps) {
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const span = useMemo(
    () => spans.find((entry) => entry.id === selectedSpanId) ?? spans[0] ?? null,
    [selectedSpanId, spans],
  );

  if (!span) {
    return (
      <Card className="border border-black/8 shadow-none">
        <CardHeader>
          <CardTitle>Span Detail</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-neutral-500">Select a span to inspect it.</CardContent>
      </Card>
    );
  }

  const details = [
    ["Span name", span.name],
    ["Type", span.span_type],
    ["Status", span.status],
    ["Latency", formatLatency(span.started_at, span.ended_at)],
    ["Provider", span.provider ?? "n/a"],
    ["Model", span.model ?? "n/a"],
    ["Input tokens", String(span.input_tokens ?? 0)],
    ["Output tokens", String(span.output_tokens ?? 0)],
    ["Total tokens", String(span.total_tokens ?? 0)],
    ["Estimated cost", `$${(span.estimated_cost ?? 0).toFixed(6)}`],
  ];

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle>Span Detail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-black/8 bg-neutral-50 p-3">
              <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">{label}</div>
              <div className="mt-2 text-sm font-medium text-neutral-950 dark:text-neutral-100">{value}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-black/8 bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">
          <pre className="overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(span.metadata ?? {}, null, 2)}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
