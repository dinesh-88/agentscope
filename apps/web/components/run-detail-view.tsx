"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Cpu, Sparkles, Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact, type Run, type RunInsight, type Span } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "prompt" | "response" | "metadata";

function spanTypeTone(spanType: string) {
  if (spanType.includes("llm")) return "bg-blue-500";
  if (spanType.includes("tool")) return "bg-emerald-500";
  if (spanType.includes("retrieval")) return "bg-amber-500";
  return "bg-slate-400";
}

function spanTypeIcon(spanType: string) {
  if (spanType.includes("llm")) return Cpu;
  if (spanType.includes("tool")) return Wrench;
  return Bot;
}

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, end - start);
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

export function RunDetailView({
  run,
  spans,
  artifacts,
  insights,
}: {
  run: Run;
  spans: Span[];
  artifacts: Artifact[];
  insights: RunInsight[];
}) {
  const ordered = useMemo(() => {
    return [...spans].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  }, [spans]);

  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(ordered[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>("prompt");

  const selectedSpan = useMemo(
    () => ordered.find((span) => span.id === selectedSpanId) ?? ordered[0] ?? null,
    [ordered, selectedSpanId],
  );

  const selectedArtifacts = useMemo(() => {
    if (!selectedSpan) return [];
    return artifacts.filter((artifact) => artifact.span_id === selectedSpan.id);
  }, [artifacts, selectedSpan]);

  const promptArtifact = useMemo(
    () =>
      selectedArtifacts.find((artifact) => artifact.kind.includes("prompt")) ??
      artifacts.find((artifact) => artifact.kind.includes("prompt")),
    [artifacts, selectedArtifacts],
  );

  const responseArtifact = useMemo(
    () =>
      selectedArtifacts.find((artifact) => artifact.kind.includes("response")) ??
      artifacts.find((artifact) => artifact.kind.includes("response")),
    [artifacts, selectedArtifacts],
  );

  const runStarted = new Date(run.started_at).getTime();

  return (
    <section className="grid gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
        <CardHeader>
          <CardTitle>Span Timeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-4">
          {ordered.map((span, index) => {
            const Icon = spanTypeIcon(span.span_type);
            const offsetMs = Math.max(0, new Date(span.started_at).getTime() - runStarted);
            const isSelected = span.id === selectedSpan?.id;
            return (
              <motion.button
                key={span.id}
                type="button"
                onClick={() => setSelectedSpanId(span.id)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02 }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition",
                  isSelected ? "border-blue-300 bg-blue-50" : "border-black/8 bg-white hover:bg-black/[0.02]",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className={`size-2.5 rounded-full ${spanTypeTone(span.span_type)}`} />
                  <div className="grid size-8 place-content-center rounded-lg bg-black/5 text-neutral-700">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className="font-medium text-neutral-900">{span.name}</p>
                    <p className="text-xs text-neutral-500">{span.span_type}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-neutral-500">
                  <p>{(span.total_tokens ?? 0).toLocaleString()} tokens</p>
                  <p>{offsetMs} ms</p>
                </div>
              </motion.button>
            );
          })}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="border border-black/5 bg-white/90 py-0 shadow-sm">
          <CardHeader>
            <CardTitle>Span Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {selectedSpan ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-neutral-500">Type</p>
                    <p className="font-medium text-neutral-900">{selectedSpan.span_type}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-neutral-500">Latency</p>
                    <p className="font-medium text-neutral-900">{durationMs(selectedSpan.started_at, selectedSpan.ended_at)} ms</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-neutral-500">Tokens</p>
                    <p className="font-medium text-neutral-900">{(selectedSpan.total_tokens ?? 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-neutral-500">Status</p>
                    <p className="font-medium text-neutral-900">{selectedSpan.status}</p>
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
                        tab === entry ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100",
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
                      <p className="rounded-lg bg-slate-50 p-3 text-sm text-neutral-500">No prompt content available.</p>
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
                  <p className="font-medium text-neutral-900">{insight.message}</p>
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
