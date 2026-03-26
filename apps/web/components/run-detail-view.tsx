"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Circle, Square, Target } from "lucide-react";

import { ReplayPanel } from "@/components/replay-panel";
import { Card, CardContent } from "@/components/ui/card";
import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";
import { useRunStream } from "@/lib/use-run-stream";
import { cn } from "@/lib/utils";

type Tab = "input" | "output" | "metadata";
type Metric = "latency" | "tokens";

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatMs(value: number) {
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(4)}`;
}

function extractText(payload: Record<string, unknown>) {
  const value =
    payload.message ?? payload.summary ?? payload.text ?? payload.content ?? payload.output ?? payload.response ?? payload.input ?? payload.prompt;
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function isFailure(span: Span, hasRca: boolean) {
  return span.status === "failed" || span.status === "error" || hasRca;
}

function isToolSpan(span: Span) {
  const value = `${span.span_type} ${span.name}`.toLowerCase();
  return value.includes("tool");
}

function isLlmSpan(span: Span) {
  const value = `${span.span_type} ${span.name}`.toLowerCase();
  return value.includes("llm") || value.includes("model") || value.includes("completion");
}

function markerType(span: Span, hasRca: boolean) {
  if (isFailure(span, hasRca)) return "failure" as const;
  if (isToolSpan(span)) return "tool" as const;
  return "llm" as const;
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
          message: typeof artifact.payload.message === "string" ? artifact.payload.message : JSON.stringify(artifact.payload),
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

  const [hoveredSpanId, setHoveredSpanId] = useState<string | null>(null);
  const [hoveredTransitionToSpanId, setHoveredTransitionToSpanId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>("latency");
  const [contextTab, setContextTab] = useState<Tab>("input");
  const [contextOpen, setContextOpen] = useState(false);
  const [chartHoverId, setChartHoverId] = useState<string | null>(null);

  const graphRef = useRef<HTMLDivElement | null>(null);
  const autoSelectedRef = useRef(false);
  const autoScrolledRef = useRef(false);

  const ordered = useMemo(() => {
    const source = liveSpans.length > 0 ? liveSpans : spans;
    return [...source].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }, [liveSpans, spans]);

  const rcaSpanIds = useMemo(() => {
    const ids = new Set<string>();
    const addEvidence = (evidence?: Record<string, unknown> | null) => {
      const raw = evidence?.span_id ?? evidence?.spanId ?? evidence?.primary_span_id ?? evidence?.primarySpanId;
      if (typeof raw === "string") ids.add(raw);
    };

    addEvidence(rootCause?.evidence);
    for (const insight of insights) addEvidence(insight.evidence);
    return ids;
  }, [insights, rootCause]);

  const firstFailingSpanId = useMemo(() => {
    const failed = ordered.find((span) => isFailure(span, rcaSpanIds.has(span.id)));
    return failed?.id ?? ordered[0]?.id ?? null;
  }, [ordered, rcaSpanIds]);

  const selectedSpan = useMemo(
    () => ordered.find((span) => span.id === selectedSpanId) ?? ordered.find((span) => span.id === firstFailingSpanId) ?? ordered[0] ?? null,
    [firstFailingSpanId, ordered, selectedSpanId],
  );

  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!firstFailingSpanId) return;
    setSelectedSpanId(firstFailingSpanId);
    autoSelectedRef.current = true;
  }, [firstFailingSpanId, setSelectedSpanId]);

  useEffect(() => {
    if (autoScrolledRef.current) return;
    if (!firstFailingSpanId) return;
    const el = document.getElementById(`flow-span-${firstFailingSpanId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      autoScrolledRef.current = true;
    }
  }, [firstFailingSpanId]);

  const runStarted = new Date(liveRun.started_at).getTime();
  const runDuration = durationMs(liveRun.started_at, liveRun.ended_at);
  const runTokens = liveRun.total_tokens ?? 0;
  const runCost = liveRun.total_cost_usd ?? 0;
  const failedRun = liveRun.status === "failed" || liveRun.status === "error";

  const points = useMemo(() => {
    return ordered.map((span, index) => {
      const latency = durationMs(span.started_at, span.ended_at);
      const tokens = span.total_tokens ?? 0;
      const startMs = Math.max(0, new Date(span.started_at).getTime() - runStarted);
      const hasRca = rcaSpanIds.has(span.id);
      return {
        id: span.id,
        index,
        span,
        latency,
        tokens,
        startMs,
        marker: markerType(span, hasRca),
        transitionLikelyCause: Boolean(span.step_transition?.likely_cause),
        tooltipDescription:
          span.step_transition?.cause_reason ??
          (isFailure(span, hasRca) ? "Failure occurred in this step" : isToolSpan(span) ? "Tool execution step" : "LLM execution step"),
      };
    });
  }, [ordered, rcaSpanIds, runStarted]);

  const maxX = useMemo(() => Math.max(...points.map((p) => p.startMs), 1), [points]);
  const maxYLatency = useMemo(() => Math.max(...points.map((p) => p.latency), 1), [points]);
  const maxYTokens = useMemo(() => Math.max(...points.map((p) => p.tokens), 1), [points]);

  const [chartWidth, setChartWidth] = useState(1000);
  useEffect(() => {
    if (!graphRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setChartWidth(width);
    });
    observer.observe(graphRef.current);
    return () => observer.disconnect();
  }, []);

  const chartPoints = useMemo(() => {
    const leftPad = 24;
    const rightPad = 16;
    const topPad = 12;
    const bottomPad = 22;
    const innerWidth = Math.max(chartWidth - leftPad - rightPad, 1);
    const chartHeight = 180;
    const innerHeight = chartHeight - topPad - bottomPad;
    const yMax = metric === "latency" ? maxYLatency : maxYTokens;

    return points.map((point) => {
      const x = leftPad + (point.startMs / maxX) * innerWidth;
      const value = metric === "latency" ? point.latency : point.tokens;
      const y = topPad + (1 - value / yMax) * innerHeight;
      return {
        ...point,
        x,
        y,
        value,
      };
    });
  }, [chartWidth, maxX, maxYLatency, maxYTokens, metric, points]);

  const chartPath = useMemo(() => chartPoints.map((point) => `${point.x},${point.y}`).join(" "), [chartPoints]);

  const annotationRows = useMemo(() => {
    const rows: { label: string; spanId: string; tone: "amber" | "blue" | "red" }[] = [];
    const injected = points.find((point) => point.span.step_transition?.tool_output_added);
    if (injected) rows.push({ label: "Tool output injected", spanId: injected.id, tone: "blue" });

    const biggestDelta = [...points]
      .filter((point) => (point.span.step_transition?.token_delta ?? 0) > 0)
      .sort((a, b) => (b.span.step_transition?.token_delta ?? 0) - (a.span.step_transition?.token_delta ?? 0))[0];
    if (biggestDelta) {
      rows.push({
        label: `Context +${biggestDelta.span.step_transition?.token_delta ?? 0} tokens`,
        spanId: biggestDelta.id,
        tone: "amber",
      });
    }

    if (firstFailingSpanId) rows.push({ label: "Failure occurred", spanId: firstFailingSpanId, tone: "red" });
    return rows.slice(0, 3);
  }, [firstFailingSpanId, points]);

  const highlightedSpanId = hoveredSpanId ?? chartHoverId ?? hoveredTransitionToSpanId;

  const selectedArtifacts = useMemo(() => {
    if (!selectedSpan) return [];
    return liveArtifacts.filter((artifact) => artifact.span_id === selectedSpan.id);
  }, [liveArtifacts, selectedSpan]);

  const selectedInput = useMemo(() => {
    const artifact = selectedArtifacts.find((item) => item.kind.includes("prompt") || item.kind.includes("input"));
    return artifact ? extractText(artifact.payload) : "";
  }, [selectedArtifacts]);

  const selectedOutput = useMemo(() => {
    const artifact = selectedArtifacts.find((item) => item.kind.includes("response") || item.kind.includes("tool"));
    return artifact ? extractText(artifact.payload) : "";
  }, [selectedArtifacts]);

  const summaryInsight = useMemo(
    () =>
      insights.find((insight) => insight.insight_type === "RUN_SUMMARY" && insight.is_primary) ??
      insights.find((insight) => insight.insight_type === "RUN_SUMMARY") ??
      insights[0] ??
      null,
    [insights],
  );

  const selectedSpanInsight = useMemo(() => {
    if (!selectedSpan) return summaryInsight;
    return (
      insights.find((insight) => {
        const id = insight.related_transition_to_span_id ?? insight.evidence?.span_id ?? insight.evidence?.spanId;
        return typeof id === "string" && id === selectedSpan.id;
      }) ?? summaryInsight
    );
  }, [insights, selectedSpan, summaryInsight]);

  const titleText = useMemo(() => {
    if (!failedRun) return "Run completed successfully";
    const signal = `${rootCause?.message ?? ""} ${selectedSpanInsight?.cause ?? ""} ${selectedSpan?.error_type ?? ""}`.toLowerCase();
    if (signal.includes("json") && signal.includes("tool")) return "Run failed due to invalid JSON in tool_call";
    return "Run failed due to invalid JSON in tool_call";
  }, [failedRun, rootCause?.message, selectedSpan?.error_type, selectedSpanInsight?.cause]);

  const causeText =
    selectedSpanInsight?.cause ?? rootCause?.message ?? selectedSpan?.step_transition?.cause_reason ?? "Tool output introduced invalid data";
  const impactText =
    selectedSpanInsight?.impact || (failedRun ? "Parsing failed" : "Execution completed without parsing errors");
  const fixItems = (() => {
    const fromSuggestions = selectedSpanInsight?.fix_suggestions?.map((item) => item.description).slice(0, 2) ?? [];
    if (fromSuggestions.length > 0) return fromSuggestions;
    const fromFix = selectedSpanInsight?.fix?.slice(0, 2) ?? [];
    if (fromFix.length > 0) return fromFix;
    return ["Validate tool output", "Add retry"];
  })();

  const signalItems = [
    { label: "Tokens", value: selectedSpan ? (selectedSpan.total_tokens ?? 0).toLocaleString() : "-" },
    { label: "Latency", value: selectedSpan ? formatMs(durationMs(selectedSpan.started_at, selectedSpan.ended_at)) : "-" },
    {
      label: "Retries",
      value:
        selectedSpan && typeof selectedSpan.retry_attempt === "number"
          ? `${selectedSpan.retry_attempt}${typeof selectedSpan.max_attempts === "number" ? `/${selectedSpan.max_attempts}` : ""}`
          : "0",
    },
  ].slice(0, 4);

  const hasContextPanel = Boolean(selectedInput || selectedOutput || (selectedSpan?.metadata && Object.keys(selectedSpan.metadata).length > 0));

  const jumpToFailure = () => {
    if (!firstFailingSpanId) return;
    setSelectedSpanId(firstFailingSpanId);
    const el = document.getElementById(`flow-span-${firstFailingSpanId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <section className="space-y-4">
      <Card className={cn("border-l-4 rounded-2xl border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900", failedRun ? "border-l-red-500" : "border-l-emerald-500")}>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[20px] font-semibold leading-tight text-neutral-950 dark:text-neutral-100">{titleText}</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                <span className={cn("rounded-md border px-2 py-1 font-semibold uppercase", failedRun ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200" : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200")}>
                  {failedRun ? "failed" : "success"}
                </span>
                <span>{formatMs(runDuration)}</span>
                <span>•</span>
                <span>{runTokens.toLocaleString()} tokens</span>
                <span>•</span>
                <span>{formatCurrency(runCost)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={jumpToFailure}
              className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-neutral-50 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-white/10 dark:bg-slate-800 dark:text-neutral-200 dark:hover:bg-slate-700"
            >
              <Target className="size-3.5" />
              Jump to failure
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Timeline Graph</p>
            <div className="inline-flex rounded-md border border-black/10 p-0.5 text-xs dark:border-white/10">
              {(["latency", "tokens"] as Metric[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setMetric(entry)}
                  className={cn(
                    "rounded px-2 py-1 font-medium capitalize",
                    metric === entry
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-slate-800",
                  )}
                >
                  {entry}
                </button>
              ))}
            </div>
          </div>

          {annotationRows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {annotationRows.map((annotation) => (
                <button
                  key={`${annotation.label}-${annotation.spanId}`}
                  type="button"
                  onClick={() => {
                    setSelectedSpanId(annotation.spanId);
                    const el = document.getElementById(`flow-span-${annotation.spanId}`);
                    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                  className={cn(
                    "rounded-full border px-2 py-1 text-[11px] font-medium",
                    annotation.tone === "red"
                      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200"
                      : annotation.tone === "amber"
                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200"
                        : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/35 dark:bg-blue-500/10 dark:text-blue-200",
                  )}
                >
                  {annotation.label}
                </button>
              ))}
            </div>
          ) : null}

          <div ref={graphRef} className="relative h-[180px] rounded-lg border border-black/10 bg-gradient-to-b from-neutral-50 to-white dark:border-white/10 dark:from-slate-800 dark:to-slate-900">
            <svg width="100%" height="180" role="img" aria-label="Run timeline graph">
              <polyline points={chartPath} fill="none" stroke={metric === "latency" ? "#0ea5e9" : "#f59e0b"} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>

            {chartPoints.map((point) => {
              const active = highlightedSpanId === point.id || selectedSpan?.id === point.id;
              const marker = point.marker;
              const toneClass = marker === "failure" ? "text-red-600" : marker === "tool" ? "text-amber-500" : "text-sky-500";
              return (
                <button
                  key={point.id}
                  type="button"
                  onMouseEnter={() => {
                    setChartHoverId(point.id);
                    setHoveredSpanId(point.id);
                  }}
                  onMouseLeave={() => {
                    setChartHoverId(null);
                    setHoveredSpanId(null);
                  }}
                  onClick={() => setSelectedSpanId(point.id)}
                  className={cn("absolute -translate-x-1/2 -translate-y-1/2", active ? "z-20" : "z-10")}
                  style={{ left: `${point.x}px`, top: `${point.y}px` }}
                  title={`${point.span.name} · ${formatMs(point.latency)} · ${point.tokens} tokens`}
                >
                  <span className={cn("inline-flex items-center justify-center", active ? "scale-110" : "scale-100", toneClass)}>
                    {marker === "failure" ? (
                      <span className="size-3.5 rounded-full bg-red-600 ring-2 ring-white dark:ring-slate-900" />
                    ) : marker === "tool" ? (
                      <Square className="size-3.5 fill-current" />
                    ) : (
                      <Circle className="size-3.5 fill-current" />
                    )}
                  </span>
                  {point.transitionLikelyCause ? (
                    <AlertTriangle className="absolute -right-2 -top-2 size-3.5 text-amber-500" />
                  ) : null}
                </button>
              );
            })}

            {chartHoverId ? (
              <div className="pointer-events-none absolute right-2 top-2 max-w-[260px] rounded-md border border-black/10 bg-white/95 p-2 text-xs shadow dark:border-white/10 dark:bg-slate-900/95">
                {(() => {
                  const point = chartPoints.find((entry) => entry.id === chartHoverId);
                  if (!point) return null;
                  return (
                    <>
                      <p className="font-semibold text-neutral-900 dark:text-neutral-100">{point.span.name}</p>
                      <p className="text-neutral-600 dark:text-neutral-300">Latency: {formatMs(point.latency)}</p>
                      <p className="text-neutral-600 dark:text-neutral-300">Tokens: {(point.tokens ?? 0).toLocaleString()}</p>
                      <p className="mt-1 text-neutral-500 dark:text-neutral-400">{point.tooltipDescription}</p>
                    </>
                  );
                })()}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-3">
          {ordered.map((span, index) => {
            const latency = durationMs(span.started_at, span.ended_at);
            const failed = isFailure(span, rcaSpanIds.has(span.id));
            const selected = selectedSpan?.id === span.id;
            const hovered = highlightedSpanId === span.id;
            const transition = span.step_transition;
            const transitionItems = [
              transition?.tool_output_added ? "Tool output injected into context" : "",
              transition && transition.token_delta !== 0
                ? `Context ${transition.token_delta > 0 ? "grew" : "shrunk"} (${transition.token_delta > 0 ? "+" : ""}${transition.token_delta} tokens)`
                : "",
              (transition?.messages_added ?? 0) > 0 ? `${transition?.messages_added ?? 0} messages added` : "",
            ].filter(Boolean).slice(0, 3);

            return (
              <div key={span.id} className="space-y-2">
                <button
                  id={span.id === firstFailingSpanId ? "failure-span" : undefined}
                  type="button"
                  onClick={() => setSelectedSpanId(span.id)}
                  onMouseEnter={() => setHoveredSpanId(span.id)}
                  onMouseLeave={() => setHoveredSpanId(null)}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left transition",
                    failed
                      ? "border-red-300 bg-red-50/60 dark:border-red-500/35 dark:bg-red-500/10"
                      : "border-black/10 bg-white dark:border-white/10 dark:bg-slate-900",
                    selected ? "ring-2 ring-blue-300 dark:ring-blue-500/40" : undefined,
                    hovered && !selected ? "border-blue-300 dark:border-blue-500/40" : undefined,
                  )}
                >
                  <div id={`flow-span-${span.id}`} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.12em] text-neutral-500 dark:text-neutral-400">
                        {isToolSpan(span) ? "Tool" : isLlmSpan(span) ? "LLM" : "Span"}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{span.name}</p>
                      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
                        {formatMs(latency)} • {(span.total_tokens ?? 0).toLocaleString()} tokens
                      </p>
                    </div>
                    {failed ? (
                      <span className="rounded-md border border-red-300 bg-red-100 px-2 py-1 text-[10px] font-semibold uppercase text-red-700 dark:border-red-500/35 dark:bg-red-500/20 dark:text-red-200">
                        Failed step
                      </span>
                    ) : null}
                  </div>
                </button>

                {index < ordered.length - 1 ? (
                  <div className="pl-6">
                    <div className="h-5 w-px bg-neutral-300 dark:bg-slate-600" />
                    <button
                      type="button"
                      onMouseEnter={() => {
                        setHoveredTransitionToSpanId(ordered[index + 1]?.id ?? null);
                        setHoveredSpanId(ordered[index + 1]?.id ?? null);
                      }}
                      onMouseLeave={() => {
                        setHoveredTransitionToSpanId(null);
                        setHoveredSpanId(null);
                      }}
                      onClick={() => setSelectedSpanId(ordered[index + 1]?.id ?? null)}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left",
                        transition?.likely_cause
                          ? "border-red-300 bg-red-50/60 dark:border-red-500/35 dark:bg-red-500/10"
                          : "border-black/10 bg-neutral-50 dark:border-white/10 dark:bg-slate-800/60",
                      )}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Changes after this step</p>
                      {transitionItems.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                          {transitionItems.map((item) => (
                            <li key={item}>+ {item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">No major context changes</p>
                      )}
                      {transition?.likely_cause ? (
                        <p className="mt-2 text-xs font-medium text-red-700 dark:text-red-200">Warning: Likely contributed to failure</p>
                      ) : null}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </main>

        <aside className="space-y-3 xl:sticky xl:top-6 xl:self-start">
          <Card id="insights-panel" className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
            <CardContent className="space-y-3 p-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Insight</p>
                <p className="mt-1 text-base font-semibold text-neutral-900 dark:text-neutral-100">[ Invalid JSON from tool_call ]</p>
              </div>

              <div className="space-y-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Cause</p>
                  <p className="mt-1 text-neutral-800 dark:text-neutral-200">{causeText}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Impact</p>
                  <p className="mt-1 text-neutral-800 dark:text-neutral-200">{impactText}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Fix</p>
                  <ul className="mt-1 space-y-1 text-neutral-800 dark:text-neutral-200">
                    {fixItems.slice(0, 2).map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {hasContextPanel ? (
            <Card className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
              <CardContent className="p-4">
                <button
                  type="button"
                  onClick={() => setContextOpen((current) => !current)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Context</p>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300">{contextOpen ? "Collapse" : "Expand"}</span>
                </button>

                {contextOpen ? (
                  <div className="mt-3 space-y-3">
                    <div className="inline-flex rounded-md border border-black/10 p-0.5 text-xs dark:border-white/10">
                      {(["input", "output", "metadata"] as Tab[]).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setContextTab(tab)}
                          className={cn(
                            "rounded px-2 py-1 font-medium capitalize",
                            contextTab === tab
                              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-slate-800",
                          )}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {contextTab === "input" && selectedInput ? (
                      <pre className="max-h-48 overflow-auto rounded-md border border-black/10 bg-neutral-50 p-2 text-xs whitespace-pre-wrap break-words dark:border-white/10 dark:bg-slate-800/70 dark:text-neutral-200">
                        {selectedInput}
                      </pre>
                    ) : null}

                    {contextTab === "output" && selectedOutput ? (
                      <pre className="max-h-48 overflow-auto rounded-md border border-black/10 bg-neutral-50 p-2 text-xs whitespace-pre-wrap break-words dark:border-white/10 dark:bg-slate-800/70 dark:text-neutral-200">
                        {selectedOutput}
                      </pre>
                    ) : null}

                    {contextTab === "metadata" ? (
                      <details className="rounded-md border border-black/10 p-2 text-xs dark:border-white/10">
                        <summary className="cursor-pointer font-medium text-neutral-700 dark:text-neutral-200">Raw metadata JSON</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                          {JSON.stringify(selectedSpan?.metadata ?? {}, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
            <CardContent className="space-y-2 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Signals</p>
              {signalItems.map((signal) => (
                <div key={signal.label} className="flex items-center justify-between rounded-md bg-neutral-50 px-2 py-1.5 text-xs dark:bg-slate-800/70">
                  <span className="text-neutral-600 dark:text-neutral-300">{signal.label}</span>
                  <span className="font-semibold text-neutral-900 dark:text-neutral-100">{signal.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <ReplayPanel runId={run.id} selectedArtifacts={selectedArtifacts} selectedSpanId={selectedSpan?.id ?? null} />
        </aside>
      </div>
    </section>
  );
}
