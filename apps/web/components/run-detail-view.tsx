"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, MoreVertical, X } from "lucide-react";

import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";
import { useRunStream } from "@/lib/use-run-stream";

type StoryItem =
  | { kind: "step"; id: string; stepType: "llm" | "tool" | "failure"; label: string; duration: string; tokens: string }
  | { kind: "change"; id: string; text: string };

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function formatMs(value: number) {
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(4)}`;
}

function isToolSpan(span: Span) {
  const value = `${span.span_type} ${span.name}`.toLowerCase();
  return value.includes("tool");
}

function isFailure(span: Span, hasRca: boolean) {
  return span.status === "failed" || span.status === "error" || hasRca;
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

  const [contextOpen, setContextOpen] = useState(false);

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

  const firstFailingSpan = useMemo(() => ordered.find((span) => isFailure(span, rcaSpanIds.has(span.id))) ?? null, [ordered, rcaSpanIds]);

  const keyChange = useMemo(() => {
    const likely = ordered.find((span) => span.step_transition?.likely_cause && (span.step_transition?.token_delta ?? 0) !== 0);
    if (likely) {
      const delta = likely.step_transition?.token_delta ?? 0;
      return `Tool output injected (+${Math.abs(delta).toLocaleString()} tokens)`;
    }

    const withToolOutput = ordered.find((span) => span.step_transition?.tool_output_added);
    if (withToolOutput) return "Tool output injected into context";

    return "Failure caused by invalid tool output injected into context";
  }, [ordered]);

  const storyItems = useMemo<StoryItem[]>(() => {
    const items: StoryItem[] = [];

    ordered.forEach((span) => {
      const failed = isFailure(span, rcaSpanIds.has(span.id));
      const stepType = failed ? "failure" : isToolSpan(span) ? "tool" : "llm";

      items.push({
        kind: "step",
        id: span.id,
        stepType,
        label: `${stepType === "tool" ? "Tool" : "LLM"} • ${span.name}`,
        duration: formatMs(durationMs(span.started_at, span.ended_at)),
        tokens: `${(span.total_tokens ?? 0).toLocaleString()} tokens`,
      });

      const transition = span.step_transition;
      const delta = transition?.token_delta ?? 0;
      if (transition?.tool_output_added || delta !== 0 || transition?.likely_cause) {
        const text =
          transition?.tool_output_added && delta > 0
            ? `Tool output injected (+${delta.toLocaleString()} tokens)`
            : transition?.tool_output_added
              ? "Tool output injected into context"
              : delta !== 0
                ? `Context ${delta > 0 ? "grew" : "shrunk"} (${delta > 0 ? "+" : ""}${delta.toLocaleString()} tokens)`
                : "Meaningful transition detected";
        items.push({ kind: "change", id: `${span.id}-change`, text });
      }
    });

    return items;
  }, [ordered, rcaSpanIds]);

  const runDuration = formatMs(durationMs(liveRun.started_at, liveRun.ended_at));
  const runTokens = `${(liveRun.total_tokens ?? 0).toLocaleString()} tokens`;
  const runCost = formatCurrency(liveRun.total_cost_usd ?? 0);
  const runModel =
    [...ordered]
      .reverse()
      .find((span) => typeof span.model === "string" && span.model.trim().length > 0)
      ?.model ?? "gpt-4.1-mini";
  const runTitle = liveRun.workflow_name || liveRun.agent_name || liveRun.id;
  const failedRun = liveRun.status === "failed" || liveRun.status === "error";

  const primaryInsight =
    insights.find((insight) => insight.is_primary)?.message ??
    insights.find((insight) => insight.message)?.message ??
    insights.find((insight) => insight.title)?.title ??
    (failedRun ? "Latency is elevated around the failing step." : "Run completed with stable execution.");

  const causeText =
    insights.find((insight) => insight.cause)?.cause ?? rootCause?.message ?? "Tool output introduced invalid data into the model context.";
  const failureSummary = `Failure caused by ${causeText.charAt(0).toLowerCase()}${causeText.slice(1)}`;

  const fixItems =
    insights
      .flatMap((insight) => insight.fix_suggestions?.map((item) => item.description) ?? insight.fix ?? [])
      .filter(Boolean)
      .slice(0, 3) || [];

  const finalFixItems = fixItems.length > 0 ? fixItems : ["Validate tool output schema before context injection", "Add retry guard for malformed tool payloads"];

  return (
    <section className="min-h-screen bg-[#0B0F1A] p-6 text-white md:p-10">
      <div className="mx-auto max-w-[1400px] rounded-xl border border-white/10 bg-[#0B0F1A] p-4 shadow-[0_0_80px_rgba(124,58,237,0.12)] md:p-6">
        <div className="mb-4 flex items-center gap-2 text-3xl text-gray-400">
          <ArrowLeft className="size-6" />
          <span>Back to runs</span>
        </div>

        <header className="rounded-xl border border-white/10 bg-gradient-to-b from-[#0F1629] to-[#0B1220] p-6">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-5xl font-bold text-white">{runTitle}</h1>
            <span className={`rounded-xl border border-white/10 px-4 py-1.5 text-2xl font-semibold uppercase ${failedRun ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"}`}>
              {failedRun ? "FAILED" : "SUCCESS"}
            </span>
          </div>
          <p className="mt-5 text-4xl text-gray-400">
            <span className="font-semibold text-white">Primary Insight:</span> {primaryInsight}
          </p>
          <div className="mt-5 border-t border-white/10 pt-4 text-3xl text-gray-400">
            {runDuration} • {runTokens} • {runCost} • {runModel}
          </div>
        </header>

        <div className="mt-4 border-y border-white/10 border-l-4 border-red-500 bg-red-500/5 px-4 py-3 text-[2rem] text-red-400">{failedRun ? failureSummary : keyChange}</div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[65fr_35fr]">
          <main className="rounded-xl border border-white/10 bg-gradient-to-b from-[#0F1629] to-[#0B1220] p-5">
            <h2 className="text-5xl font-semibold text-white">Execution Story</h2>
            <div className="mt-4 border-t border-white/10 pt-4">
              {storyItems.map((item, index) => (
                <div key={item.id} className="relative pl-10">
                  {index < storyItems.length - 1 ? <div className="absolute left-4 top-6 h-full w-px border-l border-white/10" /> : null}

                  {item.kind === "step" ? (
                    <div className={`pb-5 ${item.stepType === "failure" ? "mb-3 rounded-xl border border-white/10 bg-red-500/5 p-4 pb-4" : ""}`}>
                      {item.stepType === "failure" ? (
                        <div className="mb-2 flex items-center gap-2 text-[2.1rem] font-semibold text-red-400">
                          <X className="size-8" />
                          <span>FAILED STEP</span>
                        </div>
                      ) : null}
                      <div className="flex items-center gap-4">
                        {item.stepType === "tool" ? (
                          <span className="size-5 rounded-[4px] bg-yellow-400" />
                        ) : item.stepType === "failure" ? (
                          <span className="size-5 rounded-full bg-red-400" />
                        ) : (
                          <span className="size-5 rounded-full bg-[#3B82F6]" />
                        )}
                        <p className="text-[2.7rem] font-semibold text-white">{item.label}</p>
                      </div>
                      <p className="ml-9 mt-1 text-[2rem] text-gray-400">
                        {item.duration}
                        {item.stepType !== "tool" ? ` • ${item.tokens}` : ""}
                      </p>
                    </div>
                  ) : (
                    <div className="mb-4 ml-2 rounded-xl border border-white/10 bg-yellow-500/5 px-4 py-3">
                      <div className="flex items-center gap-3 text-[2.1rem] text-yellow-400">
                        <AlertTriangle className="size-7 text-yellow-400" />
                        <span>{item.text.includes("(") ? item.text.split("(")[0].trim() : item.text}</span>
                      </div>
                      {item.text.includes("(") ? <p className="ml-10 mt-1 text-[1.8rem] text-yellow-400">• Context grew ({item.text.split("(")[1]}</p> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </main>

          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <section className="rounded-xl border border-white/10 bg-gradient-to-b from-[#0F1629] to-[#0B1220] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-1 size-7 text-red-400" />
                  <h3 className="text-5xl font-semibold text-white">{rootCause?.message ?? insights.find((insight) => insight.title)?.title ?? "Run failure detected"}</h3>
                </div>
                <MoreVertical className="size-6 text-gray-500" />
              </div>
              <div className="mt-5 border-t border-white/10 pt-4">
                <p className="text-4xl font-semibold tracking-wide text-gray-400">CAUSE</p>
                <p className="mt-2 max-w-prose text-[2rem] text-white">{causeText}</p>
              </div>
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-4xl font-semibold tracking-wide text-gray-400">FIX</p>
                <ul className="mt-2 list-disc space-y-1 pl-7 text-[2rem] text-white">
                  {finalFixItems.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rounded-xl border border-white/10 bg-gradient-to-b from-[#0F1629] to-[#0B1220] p-4">
              <button type="button" onClick={() => setContextOpen((v) => !v)} className="flex w-full items-center justify-between text-left text-white">
                <div className="flex items-center gap-2">
                  <ChevronRight className={`size-5 transition ${contextOpen ? "rotate-90" : ""}`} />
                  <span className="text-4xl uppercase tracking-wide text-gray-400">Context</span>
                </div>
              </button>
              {contextOpen ? (
                <div className="mt-3 border-t border-white/10 pt-3 text-sm text-gray-400">
                  Failing step: {firstFailingSpan?.name ?? "N/A"}
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </div>
    </section>
  );
}
