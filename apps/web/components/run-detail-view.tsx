"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { LiveLogPanel } from "@/components/live-log-panel";
import { TraceView, type TraceSpan } from "@/components/trace-view";
import { WorkflowGraph } from "@/components/workflow-graph";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";
import { useRunStream } from "@/lib/use-run-stream";
import { cn } from "@/lib/utils";

type Tab = "prompt" | "response" | "metadata";

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatUsd(value: number | null | undefined, fractionDigits: number = 6) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `$${value.toFixed(fractionDigits)}`;
}

function parseChatMessages(payload: Record<string, unknown>) {
  const raw = payload.messages;
  if (!Array.isArray(raw)) {
    const fallback = payload.prompt ?? payload.input ?? payload.output ?? payload;
    return [{ role: "user", content: typeof fallback === "string" ? fallback : JSON.stringify(fallback, null, 2) }];
  }

  return raw.map((entry) => {
    if (typeof entry === "string") return { role: "user", content: entry };
    if (!entry || typeof entry !== "object") return { role: "user", content: JSON.stringify(entry, null, 2) };
    const role = typeof entry.role === "string" ? entry.role : "user";
    const content = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? entry, null, 2);
    return { role, content };
  });
}

function roleBubbleTone(role: string) {
  if (role === "system") return "bg-slate-100 text-slate-900 border-slate-200";
  if (role === "assistant") return "bg-emerald-50 text-emerald-900 border-emerald-100";
  return "bg-blue-50 text-blue-900 border-blue-100";
}

function artifactToText(payload: Record<string, unknown>) {
  const text = payload.text ?? payload.content ?? payload.output ?? payload.response ?? payload.input ?? payload.prompt;
  if (typeof text === "string") return text;
  return JSON.stringify(text ?? payload, null, 2);
}

export function RunDetailView({
  run,
  spans,
  artifacts,
  insights,
  rootCause,
}: {
  run: Run;
  spans: Span[];
  artifacts: Artifact[];
  insights: RunInsight[];
  rootCause: RunRootCause | null;
}) {
  const initialLogs = useMemo(
    () =>
      artifacts
        .filter((artifact) => artifact.kind === "log")
        .map((artifact) => ({
          id: artifact.id,
          run_id: artifact.run_id,
          span_id: artifact.span_id,
          level: typeof artifact.payload.level === "string" ? artifact.payload.level : "info",
          message:
            typeof artifact.payload.message === "string"
              ? artifact.payload.message
              : JSON.stringify(artifact.payload),
          timestamp: typeof artifact.payload.timestamp === "string" ? artifact.payload.timestamp : null,
          metadata:
            artifact.payload.metadata && typeof artifact.payload.metadata === "object"
              ? (artifact.payload.metadata as Record<string, unknown>)
              : null,
        })),
    [artifacts],
  );

  useRunStream({
    runId: run.id,
    initialRun: run,
    initialSpans: spans,
    initialArtifacts: artifacts,
    initialLogs,
  });
  const liveRun = useRunDetailStore((state) => state.run) ?? run;
  const liveSpans = useRunDetailStore((state) => state.spans);
  const liveArtifacts = useRunDetailStore((state) => state.artifacts);
  const liveLogs = useRunDetailStore((state) => state.logs);
  const activeSpanId = useRunDetailStore((state) => state.activeSpanId);
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const setSelectedSpanId = useRunDetailStore((state) => state.setSelectedSpanId);

  const ordered = useMemo(() => {
    const source = liveSpans.length > 0 ? liveSpans : spans;
    return [...source].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }, [liveSpans, spans]);

  useEffect(() => {
    if (!selectedSpanId && ordered[0]) {
      setSelectedSpanId(ordered[0].id);
    }
  }, [ordered, selectedSpanId, setSelectedSpanId]);

  const [tab, setTab] = useState<Tab>("prompt");

  const selectedSpan = useMemo(
    () => ordered.find((span) => span.id === selectedSpanId) ?? ordered[0] ?? null,
    [ordered, selectedSpanId],
  );
  const runStarted = new Date(liveRun.started_at).getTime();

  const rcaBySpan = useMemo(() => {
    const map = new Map<string, TraceSpan["rca"]>();
    const findSpanId = (evidence: Record<string, unknown> | null | undefined) => {
      if (!evidence) return null;
      const direct =
        evidence.span_id ??
        evidence.spanId ??
        evidence.primary_span_id ??
        evidence.primarySpanId;
      return typeof direct === "string" ? direct : null;
    };

    if (rootCause) {
      const spanId = findSpanId(rootCause.evidence);
      if (spanId) {
        map.set(spanId, {
          summary: rootCause.message,
          rootCause: rootCause.root_cause_type,
          location: spanId,
          suggestedFix: rootCause.suggested_fix,
          confidence: rootCause.confidence,
        });
      }
    }

    for (const insight of insights) {
      const spanId = findSpanId(insight.evidence);
      if (!spanId || map.has(spanId)) continue;
      map.set(spanId, {
        summary: insight.message,
        rootCause: insight.insight_type,
        location: spanId,
        suggestedFix: insight.recommendation,
      });
    }

    return map;
  }, [insights, rootCause]);

  const traceSpans = useMemo<TraceSpan[]>(() => {
    const promptBySpan = new Map<string, string>();
    const responseBySpan = new Map<string, string>();

    for (const artifact of liveArtifacts) {
      if (!artifact.span_id) continue;
      if (artifact.kind.includes("prompt") && !promptBySpan.has(artifact.span_id)) {
        promptBySpan.set(artifact.span_id, artifactToText(artifact.payload));
      }
      if (artifact.kind.includes("response") && !responseBySpan.has(artifact.span_id)) {
        responseBySpan.set(artifact.span_id, artifactToText(artifact.payload));
      }
    }

    return ordered.map((span) => {
      const latency = durationMs(span.started_at, span.ended_at);
      const status: TraceSpan["status"] =
        span.status === "error" || span.status === "failed"
          ? "error"
          : span.status === "running"
            ? "running"
            : "success";

      return {
        id: span.id,
        name: span.name,
        parentId: span.parent_span_id ?? undefined,
        startMs: Math.max(0, new Date(span.started_at).getTime() - runStarted),
        durationMs: latency,
        status,
        prompt: promptBySpan.get(span.id) ?? "No prompt captured",
        response: responseBySpan.get(span.id) ?? "No response captured",
        tokens: span.total_tokens ?? 0,
        latencyMs: latency,
        rca: rcaBySpan.get(span.id),
      };
    });
  }, [liveArtifacts, ordered, rcaBySpan, runStarted]);

  const selectedArtifacts = useMemo(() => {
    if (!selectedSpan) return [];
    return liveArtifacts.filter((artifact) => artifact.span_id === selectedSpan.id);
  }, [liveArtifacts, selectedSpan]);

  const promptArtifact = useMemo(
    () =>
      selectedArtifacts.find((artifact) => artifact.kind.includes("prompt")) ??
      liveArtifacts.find((artifact) => artifact.kind.includes("prompt")),
    [liveArtifacts, selectedArtifacts],
  );

  const responseArtifact = useMemo(
    () =>
      selectedArtifacts.find((artifact) => artifact.kind.includes("response")) ??
      liveArtifacts.find((artifact) => artifact.kind.includes("response")),
    [liveArtifacts, selectedArtifacts],
  );

  return (
    <section className="grid gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
        <CardHeader>
          <CardTitle>Span Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-4">
          <TraceView spans={traceSpans} selectedSpanId={selectedSpan?.id ?? null} onSpanSelect={setSelectedSpanId} />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border border-black/5 bg-white/90 py-0 shadow-sm dark:border-white/10 dark:bg-slate-900/90">
          <CardHeader>
            <CardTitle>Span Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {selectedSpan ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">Type</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">{selectedSpan.span_type}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">Latency</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">{durationMs(selectedSpan.started_at, selectedSpan.ended_at)} ms</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">Tokens</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">{(selectedSpan.total_tokens ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">Status</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">{selectedSpan.status}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">Tool Time</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">
                      {typeof selectedSpan.tool_latency_ms === "number" ? `${Math.max(selectedSpan.tool_latency_ms, 0).toFixed(0)} ms` : "n/a"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">LLM Cost</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">
                      {formatUsd(selectedSpan.estimated_cost, 6)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/70">
                    <p className="text-neutral-500 dark:text-neutral-400">Run Cost</p>
                    <p className="font-medium text-neutral-950 dark:text-neutral-100">
                      {formatUsd(liveRun.total_cost_usd, 4)}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-black/8 p-1">
                  {(["prompt", "response", "metadata"] as Tab[]).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setTab(entry)}
                      className={cn(
                        "rounded-lg px-3 py-2 text-xs font-medium capitalize transition",
                        tab === entry
                          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
                      )}
                    >
                      {entry}
                    </button>
                  ))}
                </div>

                {tab === "prompt" ? (
                  <div className="space-y-2">
                    {promptArtifact ? (
                      parseChatMessages(promptArtifact.payload).map((msg, idx) => (
                        <div key={`${msg.role}-${idx}`} className={`rounded-xl border p-3 text-sm ${roleBubbleTone(msg.role)}`}>
                          <p className="mb-1 text-[11px] uppercase tracking-wide opacity-70">{msg.role}</p>
                          <pre className="whitespace-pre-wrap break-words">{msg.content}</pre>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-lg bg-slate-50 p-3 text-sm text-neutral-500 dark:bg-slate-800/70 dark:text-neutral-400">No prompt content available.</p>
                    )}
                  </div>
                ) : null}

                {tab === "response" ? (
                  <div className="rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(responseArtifact?.payload ?? {}, null, 2)}
                    </pre>
                  </div>
                ) : null}

                {tab === "metadata" ? (
                  <div className="rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(selectedSpan.metadata ?? {}, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-neutral-500">No spans found for this run.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-black/5 bg-white/90 py-0 shadow-sm">
          <CardHeader>
            <CardTitle>Workflow Graph</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <WorkflowGraph
              spans={ordered}
              activeSpanId={activeSpanId}
              selectedSpanId={selectedSpan?.id ?? null}
              onSelectSpan={setSelectedSpanId}
            />
          </CardContent>
        </Card>

        <Card className="border border-black/5 bg-white/90 py-0 shadow-sm">
          <CardHeader>
            <CardTitle>Live Logs</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <LiveLogPanel logs={liveLogs} />
          </CardContent>
        </Card>

        <Card className="border border-black/5 bg-white/90 py-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-600" />
              Insights & Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-4">
            {insights.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-neutral-500">No insights generated for this run yet.</p>
            ) : (
              insights.map((insight) => (
                <div key={insight.id} className="rounded-xl border border-black/8 bg-white p-3 text-sm">
                  <p className="font-medium text-neutral-950 dark:text-neutral-100">{insight.message}</p>
                  <p className="mt-1 text-neutral-600">{insight.recommendation}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
