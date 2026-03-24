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
  if (role === "system") return "border-slate-200 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  if (role === "assistant") return "border-emerald-100 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200";
  return "border-blue-100 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-200";
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

function pickInstructionSource(
  sources: InstructionSource[],
  matcher: (source: InstructionSource) => boolean,
): InstructionSource | null {
  return sources.find(matcher) ?? null;
}

function statusTone(status: TraceSpan["status"]) {
  if (status === "error") return "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200";
  if (status === "running") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200";
  return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200";
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
  const [linkedTransitionFocus, setLinkedTransitionFocus] = useState<{
    fromSpanId: string;
    toSpanId: string;
  } | null>(null);
  const treeRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const autoFocusedRef = useRef(false);

  const ordered = useMemo(() => {
    const source = liveSpans.length > 0 ? liveSpans : spans;
    return [...source].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }, [liveSpans, spans]);

  const runStarted = new Date(liveRun.started_at).getTime();
  const runDuration = durationMs(liveRun.started_at, liveRun.ended_at);
  const isFailedRun = liveRun.status === "failed" || liveRun.status === "error";

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
        summary: insight.cause || insight.message,
        rootCause: insight.insight_type,
        location: spanId,
        suggestedFix: insight.fix?.[0] ?? insight.recommendation,
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
  const primarySummaryInsight = useMemo(
    () =>
      insights.find((insight) => insight.insight_type === "RUN_SUMMARY" && insight.is_primary) ??
      insights.find((insight) => insight.insight_type === "RUN_SUMMARY") ??
      null,
    [insights],
  );
  const fixSuggestions = useMemo(
    () =>
      (primarySummaryInsight?.fix_suggestions && primarySummaryInsight.fix_suggestions.length > 0
        ? primarySummaryInsight.fix_suggestions
        : selectedInsight?.fix_suggestions ?? []
      ).slice(0, 3),
    [primarySummaryInsight, selectedInsight],
  );
  const activeFailureInsight = primarySummaryInsight ?? selectedInsight;
  const insightSeverity = selectedInsight?.severity?.toLowerCase() ?? (selectedSpan?.status === "error" ? "high" : "low");
  const selectedInsightEvidenceSpanId = useMemo(() => {
    const value =
      activeFailureInsight?.related_transition_to_span_id ??
      activeFailureInsight?.evidence?.span_id ??
      activeFailureInsight?.evidence?.spanId;
    return typeof value === "string" ? value : null;
  }, [activeFailureInsight?.evidence, activeFailureInsight?.related_transition_to_span_id]);

  const whyFailedPoints = useMemo(() => {
    const points = [rootCause?.message, selectedInsight?.cause || selectedInsight?.message, selectedSpan?.error_type]
      .filter((value): value is string => Boolean(value))
      .slice(0, 3);
    if (points.length === 0 && selectedSpan?.status === "error") {
      return ["Span execution failed without a structured root-cause message."];
    }
    return points;
  }, [rootCause?.message, selectedInsight?.cause, selectedInsight?.message, selectedSpan?.error_type, selectedSpan?.status]);

  const recommendationPoints = useMemo(() => {
    const values = [
      rootCause?.suggested_fix,
      ...(selectedInsight?.fix ?? []),
      selectedInsight?.recommendation,
    ]
      .filter((value): value is string => Boolean(value));
    if (values.length === 0) {
      return ["Add schema validation and retry on parse failure."];
    }
    return values.slice(0, 3);
  }, [rootCause?.suggested_fix, selectedInsight?.fix, selectedInsight?.recommendation]);

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
  const agentsSource = useMemo(
    () => pickInstructionSource(instructionSources, (source) => /AGENTS\.md/i.test(source.name) || /AGENTS\.md/i.test(source.path)),
    [instructionSources],
  );
  const claudeSource = useMemo(
    () => pickInstructionSource(instructionSources, (source) => /CLAUDE\.md/i.test(source.name) || /CLAUDE\.md/i.test(source.path)),
    [instructionSources],
  );
  const contextSystemPrompt =
    selectedSpan?.context && typeof selectedSpan.context === "object" && typeof selectedSpan.context.system_prompt === "string"
      ? selectedSpan.context.system_prompt
      : "No system prompt captured";

  const contextVariables =
    selectedSpan?.context && typeof selectedSpan.context === "object" && selectedSpan.context.variables && typeof selectedSpan.context.variables === "object"
      ? (selectedSpan.context.variables as Record<string, unknown>)
      : null;
  const primaryFailingSpan = useMemo(() => ordered.find((span) => span.id === firstFailingSpanId) ?? null, [firstFailingSpanId, ordered]);
  const rootCauseSentence = useMemo(() => {
    const message =
      rootCause?.message ??
      primarySummaryInsight?.message ??
      selectedInsight?.cause ??
      selectedInsight?.message ??
      (primaryFailingSpan ? `${primaryFailingSpan.name} failed during execution` : "Run completed without a detected failure");
    return message.endsWith(".") ? message : `${message}.`;
  }, [primaryFailingSpan, primarySummaryInsight?.message, rootCause?.message, selectedInsight?.cause, selectedInsight?.message]);

  const jumpToSpan = (spanId: string | null) => {
    if (!spanId) return;
    setSelectedSpanId(spanId);
    setHoveredSpanId(spanId);
    const node = treeRefs.current.get(spanId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (typeof window !== "undefined") {
      const el = document.getElementById(`span-${spanId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const focusInsightTransition = (insight: RunInsight | null) => {
    if (!insight?.derived_from_transition) return;
    if (!insight.related_transition_from_span_id || !insight.related_transition_to_span_id) return;
    setLinkedTransitionFocus({
      fromSpanId: insight.related_transition_from_span_id,
      toSpanId: insight.related_transition_to_span_id,
    });
    jumpToSpan(insight.related_transition_to_span_id);
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-red-300 bg-red-50/95 p-3 shadow-sm dark:border-red-500/35 dark:bg-slate-900/95">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700 dark:text-red-300">Run Summary</p>
            <p className="mt-1 truncate text-sm font-medium text-red-900 dark:text-red-100">{rootCauseSentence}</p>
          </div>
          <button
            type="button"
            onClick={() => jumpToSpan(firstFailingSpanId)}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-800 dark:text-red-200 dark:hover:bg-slate-700"
          >
            Jump to failing span
          </button>
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[260px_minmax(0,1fr)_380px]">
      <aside className="min-w-0">
        <Card className="border border-black/8 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <GitBranch className="size-4 text-neutral-700 dark:text-neutral-300" />
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
                      ? "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/15"
                      : isFailing
                        ? "border-red-200 bg-red-50/50 dark:border-red-500/40 dark:bg-red-500/10"
                        : "border-black/10 bg-white hover:bg-neutral-50 dark:border-white/10 dark:bg-slate-900 dark:hover:bg-slate-800/70",
                    isHovered && !isSelected ? "border-blue-200 dark:border-blue-500/40" : undefined,
                  )}
                  style={{ paddingLeft: `${span.level * 14 + 8}px` }}
                >
                  <div className="min-w-0">
                    <p className={cn("truncate text-sm", isFailing ? "font-semibold text-red-700 dark:text-red-300" : "font-medium text-neutral-900 dark:text-neutral-100")}>
                      {span.name}
                    </p>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
          highlightedTransitionToSpanId={linkedTransitionFocus?.toSpanId ?? null}
          highlightedSpanId={linkedTransitionFocus?.toSpanId ?? null}
          totalDurationMs={runDuration}
          totalTokens={liveRun.total_tokens ?? 0}
          model={latestModel}
        />
      </main>

      <aside className="space-y-4">
        {isFailedRun ? (
          <Card
            id="insights-panel"
            data-testid="insights-panel"
            className={cn(
              "border shadow-sm",
              insightSeverity === "high"
                ? "border-red-300 bg-red-50/40 dark:border-red-500/35 dark:bg-red-500/10"
                : insightSeverity === "medium"
                  ? "border-amber-300 bg-amber-50/40 dark:border-amber-500/35 dark:bg-amber-500/10"
                  : "border-emerald-300 bg-emerald-50/30 dark:border-emerald-500/35 dark:bg-emerald-500/10",
            )}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Flame className="size-4 text-red-600 dark:text-red-300" />
                  Why this run failed
                </CardTitle>
                {activeFailureInsight?.derived_from_transition && activeFailureInsight.cause_confidence ? (
                  <span className="inline-flex rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:border-blue-500/35 dark:bg-blue-500/15 dark:text-blue-200">
                    Root cause ({activeFailureInsight.cause_confidence} confidence)
                  </span>
                ) : null}
                <span className="inline-flex rounded border border-black/10 bg-white px-2 py-1 text-[11px] text-neutral-600 dark:border-white/15 dark:bg-slate-900 dark:text-neutral-300">
                  details
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <button
                type="button"
                onClick={() => focusInsightTransition(activeFailureInsight)}
                className={cn(
                  "w-full rounded-lg border border-black/10 bg-white/70 p-3 text-left dark:border-white/10 dark:bg-slate-900/70",
                  activeFailureInsight?.derived_from_transition ? "cursor-pointer hover:border-blue-300 dark:hover:border-blue-500/40" : undefined,
                )}
              >
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">Cause</p>
                {activeFailureInsight?.derived_from_transition ? (
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.15em] text-blue-700 dark:text-blue-300">Linked to previous step</p>
                ) : null}
                <p className="mt-1 text-neutral-700 dark:text-neutral-300">{activeFailureInsight?.cause ?? activeFailureInsight?.message ?? rootCause?.message ?? "No explicit cause detected."}</p>
              </button>

              <div className="rounded-lg border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/70">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">Reasoning</p>
                <ul className="mt-1 space-y-1 text-neutral-700 dark:text-neutral-300">
                  {(selectedSpan?.step_transition?.cause_reason
                    ? [selectedSpan.step_transition.cause_reason]
                    : selectedInsight?.evidence?.reason && typeof selectedInsight.evidence.reason === "string"
                      ? [selectedInsight.evidence.reason]
                      : whyFailedPoints
                  ).slice(0, 3).map((point) => (
                    <li key={point}>- {point}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-900/70">
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">Fix</p>
                {fixSuggestions.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {fixSuggestions.map((fix, index) => (
                      <button
                        key={`${fix.title}-${fix.action_type}`}
                        type="button"
                        onClick={() => jumpToSpan(selectedInsightEvidenceSpanId ?? selectedSpan?.id ?? firstFailingSpanId)}
                        className={cn(
                          "w-full rounded-md border p-2 text-left",
                          index === 0
                            ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-100"
                            : "border-black/10 bg-neutral-50 text-neutral-700 dark:border-white/10 dark:bg-slate-800/70 dark:text-neutral-300",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{fix.title}</p>
                          <span className="rounded-full border border-black/15 bg-white px-2 py-0.5 text-[10px] uppercase text-neutral-600 dark:border-white/20 dark:bg-slate-900 dark:text-neutral-300">
                            {fix.action_type}
                          </span>
                        </div>
                        <p className="mt-1 text-xs">{fix.description}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">No actionable fixes generated yet.</p>
                )}
              </div>

              <div>
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">Impact</p>
                <ul className="mt-1 space-y-1 text-neutral-700 dark:text-neutral-300">
                  {(impactPoints.length > 0 ? impactPoints : ["No explicit impact metadata captured"]).map((point) => (
                    <li key={point}>- {point}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-semibold text-neutral-900 dark:text-neutral-100">Next Action</p>
                <ul className="mt-1 space-y-1 text-neutral-700 dark:text-neutral-300">
                  {recommendationPoints.map((point) => (
                    <li key={point}>- {point}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card className="border border-black/8 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Span Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedSpan ? (
              <>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-neutral-50 p-2 dark:bg-slate-800">
                    <p className="text-neutral-500 dark:text-neutral-400">Tokens</p>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{(selectedSpan.total_tokens ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 p-2 dark:bg-slate-800">
                    <p className="text-neutral-500 dark:text-neutral-400">Latency</p>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{formatMs(durationMs(selectedSpan.started_at, selectedSpan.ended_at))}</p>
                  </div>
                  <div className="rounded-lg bg-neutral-50 p-2 dark:bg-slate-800">
                    <p className="text-neutral-500 dark:text-neutral-400">Status</p>
                    <p className="font-medium text-neutral-900 capitalize dark:text-neutral-100">{selectedSpan.status}</p>
                  </div>
                </div>

                <div className="flex gap-2 rounded-lg border border-black/10 p-1 dark:border-white/10">
                  {(["context", "output", "metadata"] as Tab[]).map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setTab(entry)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-medium capitalize",
                        tab === entry
                          ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-slate-800",
                      )}
                    >
                      {entry}
                    </button>
                  ))}
                </div>

                {tab === "context" ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Context</p>
                      <p className="text-xs text-neutral-600 dark:text-neutral-300">Prompt</p>
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
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">No prompt content captured.</p>
                        )}
                        {previewPromptMessages.overflow > 0 ? <p className="text-xs text-neutral-500 dark:text-neutral-400">+{previewPromptMessages.overflow} more messages</p> : null}
                      </div>
                    </div>

                    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <p className="text-xs text-neutral-600 dark:text-neutral-300">System prompt</p>
                      <p className="mt-1 line-clamp-4 text-xs text-neutral-800 dark:text-neutral-200">{contextSystemPrompt}</p>
                    </div>

                    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <p className="text-xs text-neutral-600 dark:text-neutral-300">Variables</p>
                      {contextVariables && Object.keys(contextVariables).length > 0 ? (
                        <div className="mt-1 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                          {Object.entries(contextVariables)
                            .slice(0, 4)
                            .map(([key, value]) => (
                              <div key={key} className="truncate">
                                <span className="font-semibold">{key}:</span> {typeof value === "string" ? value : JSON.stringify(value)}
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">No variables captured.</p>
                      )}
                    </div>
                  </div>
                ) : null}

                {tab === "output" ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Output</p>
                      {outputSummaries.shown.length > 0 ? (
                        <ul className="space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                          {outputSummaries.shown.map((item) => (
                            <li key={item} className="truncate">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">No tool/response outputs attached to this span.</p>
                      )}
                      {outputSummaries.overflow > 0 ? <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">+{outputSummaries.overflow} more outputs</p> : null}
                    </div>

                    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Signals</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded bg-neutral-50 p-2 dark:bg-slate-800">Tokens: {(selectedSpan.total_tokens ?? 0).toLocaleString()}</div>
                        <div className="rounded bg-neutral-50 p-2 dark:bg-slate-800">Latency: {formatMs(durationMs(selectedSpan.started_at, selectedSpan.ended_at))}</div>
                        <div className="rounded bg-neutral-50 p-2 dark:bg-slate-800">Errors: {selectedSpan.error_type ?? "none"}</div>
                        <div className="rounded bg-neutral-50 p-2 dark:bg-slate-800">Tool latency: {typeof selectedSpan.tool_latency_ms === "number" ? `${selectedSpan.tool_latency_ms.toFixed(0)}ms` : "n/a"}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {tab === "metadata" ? (
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Metadata</p>
                      {compactMetadata.shown.length > 0 ? (
                        <ul className="space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                          {compactMetadata.shown.map((item) => (
                            <li key={item} className="truncate">{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">No metadata captured.</p>
                      )}
                      {compactMetadata.overflow > 0 ? <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">+{compactMetadata.overflow} more fields</p> : null}
                    </div>

                    <details className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-700 dark:text-neutral-300">Show raw metadata JSON</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                        {JSON.stringify(selectedSpan.metadata ?? {}, null, 2)}
                      </pre>
                    </details>

                    <details className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <summary className="cursor-pointer text-xs font-medium text-neutral-700 dark:text-neutral-300">Show raw response JSON</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                        {JSON.stringify(responseArtifact?.payload ?? {}, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">No spans found for this run.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-black/8 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Instruction Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Precedence</p>
              <ol className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                <li>1. system prompt</li>
                <li>2. AGENTS.md</li>
                <li>3. CLAUDE.md</li>
              </ol>
            </div>

                <div className="space-y-2">
                  <div className="rounded-lg border border-black/10 p-3 text-xs dark:border-white/10">
                    <p className="font-semibold text-neutral-700 dark:text-neutral-200">Global</p>
                    <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                      CLAUDE.md {claudeSource ? "captured" : "not captured"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-black/10 p-3 text-xs dark:border-white/10">
                    <p className="font-semibold text-neutral-700 dark:text-neutral-200">Local</p>
                    <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                      AGENTS.md {agentsSource ? "captured" : "not captured"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-black/10 p-3 text-xs dark:border-white/10">
                    <p className="font-semibold text-neutral-700 dark:text-neutral-200">Runtime</p>
                <p className="mt-1 line-clamp-3 text-neutral-600 dark:text-neutral-400">{contextSystemPrompt}</p>
              </div>
            </div>

            <div className="space-y-2">
              {instructionSources.length > 0 ? (
                instructionSources.map((source, index) => (
                  <details key={`${source.name}-${index}`} className="rounded-lg border border-black/10 p-3 text-xs dark:border-white/10">
                    <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-200">
                      {source.name} ({source.type})
                    </summary>
                    <p className="mt-1 text-neutral-500 dark:text-neutral-400">{source.path}</p>
                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                      {source.content}
                    </pre>
                  </details>
                ))
              ) : (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">No instruction source payload captured for this span.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <ReplayPanel runId={run.id} selectedArtifacts={selectedArtifacts} selectedSpanId={selectedSpan?.id ?? null} />
      </aside>
      </div>
    </section>
  );
}
