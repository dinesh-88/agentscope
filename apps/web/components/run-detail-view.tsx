"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  GitBranch,
  Loader2,
} from "lucide-react";

import { ReplayPanel } from "@/components/replay-panel";
import { TraceView, type TraceSpan } from "@/components/trace-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";
import { useRunStream } from "@/lib/use-run-stream";
import { cn } from "@/lib/utils";

type Tab = "context" | "output" | "metadata";

type DecoratedSpan = Span & {
  level: number;
};

type InstructionSource = {
  name: string;
  type: string;
  path: string;
  content: string;
};

const CONTEXT_INSIGHT_TYPES = new Set([
  "CONTEXT_BLOAT",
  "DOMINANT_CONTEXT_SOURCE",
  "CONTEXT_REDUNDANCY",
  "MISSING_CONTEXT",
  "PROMPT_WITH_CONTEXT_TOO_LARGE",
  "CONTEXT_TOO_LARGE",
  "CONTEXT_TRUNCATED",
  "CONTEXT_LIKELY_CAUSED_FAILURE",
  "STEP_TRANSITION_ISSUE",
]);

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatMs(value: number) {
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
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

function buildTree(spans: Span[]): DecoratedSpan[] {
  const byParent = new Map<string | null, Span[]>();

  for (const span of spans) {
    const bucket = byParent.get(span.parent_span_id ?? null) ?? [];
    bucket.push(span);
    byParent.set(span.parent_span_id ?? null, bucket);
  }

  for (const [key, bucket] of byParent.entries()) {
    byParent.set(
      key,
      bucket.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()),
    );
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

function normalizeStatus(status: string, isRcaFailingSpan: boolean): TraceSpan["status"] {
  if (status === "error" || status === "failed" || isRcaFailingSpan) return "error";
  if (status === "running") return "running";
  return "success";
}

function extractTextFromPayload(payload: Record<string, unknown>) {
  const value =
    payload.message ??
    payload.summary ??
    payload.text ??
    payload.content ??
    payload.output ??
    payload.response ??
    payload.input ??
    payload.prompt;
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function compactValues(values: string[], maxItems: number = 4) {
  return {
    shown: values.slice(0, maxItems),
    overflow: Math.max(values.length - maxItems, 0),
  };
}

function parseInstructionSources(span: Span | null): InstructionSource[] {
  const raw = span?.instruction_context;
  if (!raw || typeof raw !== "object") return [];

  const context = raw as Record<string, unknown>;
  if (!Array.isArray(context.sources)) return [];

  return context.sources
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name : "unknown",
      type: typeof entry.type === "string" ? entry.type : "local",
      path: typeof entry.path === "string" ? entry.path : "-",
      content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? "", null, 2),
    }));
}

function statusTone(status: TraceSpan["status"]) {
  if (status === "error") return "border-red-300 bg-red-50 text-red-700";
  if (status === "running") return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-emerald-300 bg-emerald-50 text-emerald-700";
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
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const setSelectedSpanId = useRunDetailStore((state) => state.setSelectedSpanId);

  const [tab, setTab] = useState<Tab>("context");
  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const treeRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const autoFocusedRef = useRef(false);

  const ordered = useMemo(() => {
    const source = liveSpans.length > 0 ? liveSpans : spans;
    return [...source].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }, [liveSpans, spans]);

  const runStarted = new Date(liveRun.started_at).getTime();
  const runDuration = durationMs(liveRun.started_at, liveRun.ended_at);

  const latestModel = useMemo(
    () =>
      ordered
        .slice()
        .reverse()
        .find((span) => typeof span.model === "string" && span.model.length > 0)?.model ?? "n/a",
    [ordered],
  );

  const rcaBySpan = useMemo(() => {
    const map = new Map<string, TraceSpan["rca"]>();
    const findSpanId = (evidence: Record<string, unknown> | null | undefined) => {
      if (!evidence) return null;
      const direct = evidence.span_id ?? evidence.spanId ?? evidence.primary_span_id ?? evidence.primarySpanId;
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

  const firstFailingSpanId = useMemo(() => {
    const hardFail = ordered.find((span) => span.status === "failed" || span.status === "error");
    if (hardFail) return hardFail.id;
    const rcaId = ordered.find((span) => rcaBySpan.has(span.id))?.id;
    if (rcaId) return rcaId;
    return ordered[0]?.id ?? null;
  }, [ordered, rcaBySpan]);

  useEffect(() => {
    if (autoFocusedRef.current) return;
    if (!firstFailingSpanId) return;
    setSelectedSpanId(firstFailingSpanId);
    autoFocusedRef.current = true;
  }, [firstFailingSpanId, setSelectedSpanId]);

  useEffect(() => {
    if (!selectedSpanId) return;
    const target = treeRefs.current.get(selectedSpanId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedSpanId]);

  const selectedSpan = useMemo(
    () => ordered.find((span) => span.id === selectedSpanId) ?? ordered[0] ?? null,
    [ordered, selectedSpanId],
  );

  const orderedTree = useMemo(() => buildTree(ordered), [ordered]);

  const traceSpans = useMemo<TraceSpan[]>(() => {
    const promptBySpan = new Map<string, string>();
    const responseBySpan = new Map<string, string>();

    for (const artifact of liveArtifacts) {
      if (!artifact.span_id) continue;
      if (artifact.kind.includes("prompt") && !promptBySpan.has(artifact.span_id)) {
        promptBySpan.set(artifact.span_id, extractTextFromPayload(artifact.payload));
      }
      if (artifact.kind.includes("response") && !responseBySpan.has(artifact.span_id)) {
        responseBySpan.set(artifact.span_id, extractTextFromPayload(artifact.payload));
      }
    }

    return ordered.map((span) => {
      const latency = durationMs(span.started_at, span.ended_at);
      const isRcaFailingSpan = rcaBySpan.has(span.id);

      return {
        id: span.id,
        name: span.name,
        parentId: span.parent_span_id ?? undefined,
        spanType: span.span_type,
        startMs: Math.max(0, new Date(span.started_at).getTime() - runStarted),
        durationMs: latency,
        status: normalizeStatus(span.status, isRcaFailingSpan),
        prompt: promptBySpan.get(span.id) ?? "No prompt captured",
        response: responseBySpan.get(span.id) ?? "No response captured",
        tokens: span.total_tokens ?? 0,
        latencyMs: latency,
        contextUsagePercent: span.context_usage_percent ?? null,
        stepTransition: span.step_transition ?? null,
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

  const contextInsights = useMemo(
    () => insights.filter((insight) => CONTEXT_INSIGHT_TYPES.has(insight.insight_type)),
    [insights],
  );

  const selectedInsight = useMemo(() => {
    if (!selectedSpan) return insights[0] ?? null;
    return (
      insights.find((insight) => {
        const spanId = insight.evidence?.span_id ?? insight.evidence?.spanId;
        return typeof spanId === "string" && spanId === selectedSpan.id;
      }) ?? insights[0] ?? null
    );
  }, [insights, selectedSpan]);
  const insightSeverity = selectedInsight?.severity?.toLowerCase() ?? (selectedSpan?.status === "error" ? "high" : "low");

  const whyFailedPoints = useMemo(() => {
    const points = [rootCause?.message, selectedInsight?.message, selectedSpan?.error_type]
      .filter((value): value is string => Boolean(value))
      .slice(0, 3);
    if (points.length === 0 && selectedSpan?.status === "error") {
      return ["Span execution failed without a structured root-cause message."];
    }
    return points;
  }, [rootCause?.message, selectedInsight?.message, selectedSpan?.error_type, selectedSpan?.status]);

  const recommendationPoints = useMemo(() => {
    const values = [rootCause?.suggested_fix, selectedInsight?.recommendation]
      .filter((value): value is string => Boolean(value));
    if (values.length === 0) {
      return ["Add schema validation and retry on parse failure."];
    }
    return values.slice(0, 3);
  }, [rootCause?.suggested_fix, selectedInsight?.recommendation]);

  const impactPoints = useMemo(() => {
    const list: string[] = [];
    if (selectedSpan?.status === "error" || selectedSpan?.status === "failed") {
      list.push("Broke downstream processing");
    }
    if (durationMs(liveRun.started_at, liveRun.ended_at) > 3000) {
      list.push("Increased latency");
    }
    if (contextInsights.length > 0) {
      list.push("Context overhead likely increased failure risk");
    }
    return list.slice(0, 3);
  }, [contextInsights.length, liveRun.ended_at, liveRun.started_at, selectedSpan?.status]);

  const promptMessages = useMemo(
    () => (promptArtifact ? parseChatMessages(promptArtifact.payload) : []),
    [promptArtifact],
  );

  const previewPromptMessages = useMemo(() => compactValues(promptMessages.map((entry) => `${entry.role}: ${entry.content}`), 4), [promptMessages]);

  const outputSummaries = useMemo(() => {
    const outputs = selectedArtifacts
      .filter((artifact) => artifact.kind.includes("response") || artifact.kind.includes("tool"))
      .map((artifact) => `${artifact.kind}: ${extractTextFromPayload(artifact.payload).replace(/\s+/g, " ").slice(0, 180)}`);
    return compactValues(outputs, 4);
  }, [selectedArtifacts]);

  const metadataEntries = useMemo(() => Object.entries(selectedSpan?.metadata ?? {}), [selectedSpan?.metadata]);
  const compactMetadata = useMemo(
    () =>
      compactValues(
        metadataEntries.map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
        4,
      ),
    [metadataEntries],
  );

  const instructionSources = useMemo(() => parseInstructionSources(selectedSpan), [selectedSpan]);

  const contextSystemPrompt =
    selectedSpan?.context && typeof selectedSpan.context === "object" && typeof selectedSpan.context.system_prompt === "string"
      ? selectedSpan.context.system_prompt
      : "No system prompt captured";

  const contextVariables =
    selectedSpan?.context && typeof selectedSpan.context === "object" && selectedSpan.context.variables && typeof selectedSpan.context.variables === "object"
      ? (selectedSpan.context.variables as Record<string, unknown>)
      : null;

  return (
    <section className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
      <aside className="min-w-0">
        <Card className="border border-black/8 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="size-4 text-neutral-700" />
              Span Tree
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[78vh] space-y-2 overflow-auto pr-2">
            {orderedTree.map((span) => {
              const status = normalizeStatus(span.status, rcaBySpan.has(span.id));
              const isSelected = selectedSpan?.id === span.id;
              const isHovered = hoveredSpanId === span.id;
              const isFailing = status === "error";
              const Icon = status === "error" ? AlertTriangle : status === "running" ? Loader2 : CheckCircle2;

              return (
                <button
                  key={span.id}
                  ref={(node) => {
                    treeRefs.current.set(span.id, node);
                  }}
                  type="button"
                  onClick={() => setSelectedSpanId(span.id)}
                  onMouseEnter={() => setHoveredSpanId(span.id)}
                  onMouseLeave={() => setHoveredSpanId(null)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left transition",
                    isSelected
                      ? "border-blue-300 bg-blue-50"
                      : isFailing
                        ? "border-red-200 bg-red-50/50"
                        : "border-black/10 bg-white hover:bg-neutral-50",
                    isHovered && !isSelected ? "border-blue-200" : undefined,
                  )}
                  style={{ paddingLeft: `${span.level * 14 + 8}px` }}
                >
                  <div className="min-w-0">
                    <p className={cn("truncate text-sm", isFailing ? "font-semibold text-red-700" : "font-medium text-neutral-900")}>
                      {span.name}
                    </p>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500">
                      <Icon className={cn("size-3", status === "running" ? "animate-spin" : undefined)} />
                      <span>{formatMs(durationMs(span.started_at, span.ended_at))}</span>
                    </div>
                  </div>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", statusTone(status))}>
                    {status === "error" ? "failed" : status}
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </aside>

      <main className="min-w-0">
        <TraceView
          spans={traceSpans}
          selectedSpanId={selectedSpan?.id ?? null}
          hoveredSpanId={hoveredSpanId}
          onSpanSelect={setSelectedSpanId}
          onSpanHover={setHoveredSpanId}
          totalDurationMs={runDuration}
          totalTokens={liveRun.total_tokens ?? 0}
          model={latestModel}
        />
      </main>

      <aside className="space-y-4">
        <Card
          id="insights-panel"
          data-testid="insights-panel"
          className={cn(
            "border shadow-sm",
            insightSeverity === "high"
              ? "border-red-300 bg-red-50/40"
              : insightSeverity === "medium"
                ? "border-amber-300 bg-amber-50/40"
                : "border-emerald-300 bg-emerald-50/30",
          )}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Flame className="size-4 text-red-600" />
                Why this run failed
              </CardTitle>
              <span className="inline-flex rounded border border-black/10 bg-white px-2 py-1 text-[11px] text-neutral-600">
                details
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-semibold text-neutral-900">Findings</p>
              <ul className="mt-1 space-y-1 text-neutral-700">
                {whyFailedPoints.map((point) => (
                  <li key={point} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 size-3 text-red-600" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-neutral-900">Recommendation</p>
              <ul className="mt-1 space-y-1 text-neutral-700">
                {recommendationPoints.map((point) => (
                  <li key={point}>- {point}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold text-neutral-900">Impact</p>
              <ul className="mt-1 space-y-1 text-neutral-700">
                {(impactPoints.length > 0 ? impactPoints : ["No explicit impact metadata captured"]).map((point) => (
                  <li key={point}>- {point}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-black/8 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Span Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedSpan ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-neutral-50 p-2">
                    <p className="text-neutral-500">Tokens</p>
                    <p className="font-medium text-neutral-900">{(selectedSpan.total_tokens ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 p-2">
                    <p className="text-neutral-500">Latency</p>
                    <p className="font-medium text-neutral-900">{formatMs(durationMs(selectedSpan.started_at, selectedSpan.ended_at))}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 p-2">
                    <p className="text-neutral-500">Status</p>
                    <p className="font-medium text-neutral-900 capitalize">{selectedSpan.status}</p>
                  </div>
                </div>

                <div className="flex gap-2 rounded-lg border border-black/10 p-1">
                  {(["context", "output", "metadata"] as Tab[]).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setTab(entry)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium capitalize",
                        tab === entry ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
                      )}
                    >
                      {entry}
                    </button>
                  ))}
                </div>

                {tab === "context" ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border border-black/10 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Context</p>
                      <p className="text-xs text-neutral-600">Prompt</p>
                      <div className="mt-1 space-y-1">
                        {previewPromptMessages.shown.length > 0 ? (
                          previewPromptMessages.shown.map((entry) => {
                            const [role, ...contentParts] = entry.split(":");
                            const content = contentParts.join(":").trim();
                            return (
                              <div key={entry} className={cn("rounded border px-2 py-1 text-xs", roleBubbleTone(role))}>
                                <span className="font-semibold uppercase">{role}</span>
                                <span className="ml-1">{content.slice(0, 180)}</span>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-xs text-neutral-500">No prompt content captured.</p>
                        )}
                        {previewPromptMessages.overflow > 0 ? <p className="text-xs text-neutral-500">+{previewPromptMessages.overflow} more messages</p> : null}
                      </div>
                    </div>

                    <div className="rounded-lg border border-black/10 p-3">
                      <p className="text-xs text-neutral-600">System prompt</p>
                      <p className="mt-1 line-clamp-4 text-xs text-neutral-800">{contextSystemPrompt}</p>
                    </div>

                    <div className="rounded-lg border border-black/10 p-3">
                      <p className="text-xs text-neutral-600">Variables</p>
                      {contextVariables && Object.keys(contextVariables).length > 0 ? (
                        <div className="mt-1 space-y-1 text-xs text-neutral-700">
                          {Object.entries(contextVariables)
                            .slice(0, 4)
                            .map(([key, value]) => (
                              <div key={key} className="truncate">
                                <span className="font-semibold">{key}:</span> {typeof value === "string" ? value : JSON.stringify(value)}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-neutral-500">No variables captured.</p>
                      )}
                    </div>
                  </div>
                ) : null}

                {tab === "output" ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border border-black/10 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Output</p>
                      {outputSummaries.shown.length > 0 ? (
                        <ul className="space-y-1 text-xs text-neutral-700">
                          {outputSummaries.shown.map((item) => (
                            <li key={item} className="truncate">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500">No tool/response outputs attached to this span.</p>
                      )}
                      {outputSummaries.overflow > 0 ? <p className="mt-1 text-xs text-neutral-500">+{outputSummaries.overflow} more outputs</p> : null}
                    </div>

                    <div className="rounded-lg border border-black/10 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Signals</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-neutral-50 p-2">Tokens: {(selectedSpan.total_tokens ?? 0).toLocaleString()}</div>
                        <div className="rounded bg-neutral-50 p-2">Latency: {formatMs(durationMs(selectedSpan.started_at, selectedSpan.ended_at))}</div>
                        <div className="rounded bg-neutral-50 p-2">Errors: {selectedSpan.error_type ?? "none"}</div>
                        <div className="rounded bg-neutral-50 p-2">Tool latency: {typeof selectedSpan.tool_latency_ms === "number" ? `${selectedSpan.tool_latency_ms.toFixed(0)}ms` : "n/a"}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {tab === "metadata" ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border border-black/10 p-3">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Metadata</p>
                      {compactMetadata.shown.length > 0 ? (
                        <ul className="space-y-1 text-xs text-neutral-700">
                          {compactMetadata.shown.map((item) => (
                            <li key={item} className="truncate">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500">No metadata captured.</p>
                      )}
                      {compactMetadata.overflow > 0 ? <p className="mt-1 text-xs text-neutral-500">+{compactMetadata.overflow} more fields</p> : null}
                    </div>

                    <details className="rounded-lg border border-black/10 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-700">Show raw metadata JSON</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                        {JSON.stringify(selectedSpan.metadata ?? {}, null, 2)}
                      </pre>
                    </details>

                    <details className="rounded-lg border border-black/10 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-700">Show raw response JSON</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                        {JSON.stringify(responseArtifact?.payload ?? {}, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-neutral-500">No spans found for this run.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-black/8 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Instruction Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-black/10 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Precedence</p>
              <ol className="mt-2 space-y-1 text-xs text-neutral-700">
                <li>1. system prompt</li>
                <li>2. AGENTS.md</li>
                <li>3. CLAUDE.md</li>
              </ol>
            </div>

            <div className="space-y-2">
              <div className="rounded-lg border border-black/10 p-3 text-xs">
                <p className="font-semibold text-neutral-700">Global</p>
                <p className="mt-1 text-neutral-600">CLAUDE.md</p>
              </div>
              <div className="rounded-lg border border-black/10 p-3 text-xs">
                <p className="font-semibold text-neutral-700">Local</p>
                <p className="mt-1 text-neutral-600">AGENTS.md</p>
              </div>
              <div className="rounded-lg border border-black/10 p-3 text-xs">
                <p className="font-semibold text-neutral-700">Runtime</p>
                <p className="mt-1 line-clamp-3 text-neutral-600">{contextSystemPrompt}</p>
              </div>
            </div>

            <div className="space-y-2">
              {instructionSources.length > 0 ? (
                instructionSources.map((source, index) => (
                  <details key={`${source.name}-${index}`} className="rounded-lg border border-black/10 p-3 text-xs">
                    <summary className="cursor-pointer font-medium text-neutral-700">
                      {source.name} ({source.type})
                    </summary>
                    <p className="mt-1 text-neutral-500">{source.path}</p>
                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                      {source.content}
                    </pre>
                  </details>
                ))
              ) : (
                <p className="text-xs text-neutral-500">No instruction source payload captured for this span.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <ReplayPanel runId={run.id} selectedArtifacts={selectedArtifacts} selectedSpanId={selectedSpan?.id ?? null} />
      </aside>
    </section>
  );
}
