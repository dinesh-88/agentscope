"use client";

import { useMemo } from "react";
import { Braces, FileCode2, TerminalSquare } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact, type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";

type SpanDetailsPanelProps = {
  spans: Span[];
  artifacts: Artifact[];
};

function formatMetadataValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function SpanDetailsPanel({ spans, artifacts }: SpanDetailsPanelProps) {
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);

  const selectedSpan = useMemo(
    () => spans.find((span) => span.id === selectedSpanId) ?? spans[0] ?? null,
    [selectedSpanId, spans]
  );

  const spanArtifacts = useMemo(() => {
    if (!selectedSpan) {
      return [];
    }
    return artifacts.filter((artifact) => artifact.span_id === selectedSpan.id);
  }, [artifacts, selectedSpan]);

  if (!selectedSpan) {
    return (
      <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:border-slate-700/80 dark:bg-slate-900">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <Braces className="size-4 text-teal-600" />
            Span details
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500 dark:text-slate-400">
          No spans were captured for this run.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:border-slate-700/80 dark:bg-slate-900">
      <CardHeader className="pt-6">
        <CardTitle className="flex items-center gap-2">
          <Braces className="size-4 text-teal-600" />
          Span details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/70">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Selected span</div>
          <div className="mt-2 text-lg font-semibold text-slate-950 dark:text-slate-100">{selectedSpan.name}</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {selectedSpan.span_type} · {selectedSpan.status}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-950 dark:text-slate-100">
            <TerminalSquare className="size-4 text-amber-600" />
            Metadata
          </div>
          {selectedSpan.metadata && Object.keys(selectedSpan.metadata).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(selectedSpan.metadata).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-700/80 dark:bg-slate-800/70">
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{key}</div>
                  <pre className="overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-800 dark:text-slate-200">
                    {formatMetadataValue(value)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
              No metadata was captured for this span.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-950 dark:text-slate-100">
            <FileCode2 className="size-4 text-cyan-600" />
            Artifacts
          </div>
          {spanArtifacts.length > 0 ? (
            <div className="space-y-3">
              {spanArtifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4 dark:border-slate-700/80 dark:bg-slate-800/70">
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{artifact.kind}</div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                    {JSON.stringify(artifact.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
              No artifacts were attached to this span.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
