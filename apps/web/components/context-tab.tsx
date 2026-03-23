"use client";

import { useMemo, useState } from "react";

import { type Artifact } from "@/lib/api";

type ContextSource = {
  name: string;
  type: "file" | "runtime";
  content: string;
  hash: string;
};

type ContextPayload = {
  sources: ContextSource[];
  finalPrompt: string;
};

type ContextTabProps = {
  artifact: Artifact | null;
};

function toContextPayload(artifact: Artifact | null): ContextPayload | null {
  if (!artifact || artifact.kind !== "llm.context") {
    return null;
  }

  const root = artifact.payload;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  const rawSources = data.sources;
  const sources: ContextSource[] = Array.isArray(rawSources)
    ? rawSources
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "unknown",
          type: entry.type === "runtime" ? "runtime" : "file",
          content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? "", null, 2),
          hash: typeof entry.hash === "string" ? entry.hash : "",
        }))
    : [];

  const rawFinalPrompt = data.final_prompt;
  const finalPrompt =
    typeof rawFinalPrompt === "string"
      ? rawFinalPrompt
      : JSON.stringify(rawFinalPrompt ?? "", null, 2);

  return {
    sources,
    finalPrompt,
  };
}

function sourceSize(source: ContextSource) {
  return source.content.length;
}

export function ContextTab({ artifact }: ContextTabProps) {
  const contextPayload = useMemo(() => toContextPayload(artifact), [artifact]);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState(0);
  const safeSelectedIndex = useMemo(() => {
    const sourceCount = contextPayload?.sources.length ?? 0;
    if (sourceCount === 0) return 0;
    return Math.min(selectedSourceIndex, sourceCount - 1);
  }, [contextPayload?.sources.length, selectedSourceIndex]);
  const selectedSource = contextPayload?.sources[safeSelectedIndex] ?? null;

  const summary = useMemo(() => {
    const sources = contextPayload?.sources ?? [];
    const totalChars = sources.reduce((sum, source) => sum + sourceSize(source), 0);
    const largest = sources.reduce<ContextSource | null>(
      (current, source) => {
        if (!current) return source;
        return sourceSize(source) > sourceSize(current) ? source : current;
      },
      null
    );

    return {
      count: sources.length,
      totalChars,
      largestName: largest?.name ?? "-",
    };
  }, [contextPayload]);

  if (!contextPayload) {
    return (
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-neutral-500 dark:bg-slate-800/70 dark:text-neutral-400">
        No context captured for this span
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
          <p className="text-neutral-500 dark:text-neutral-400">Sources</p>
          <p className="mt-1 font-semibold text-neutral-950 dark:text-neutral-100">{summary.count}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
          <p className="text-neutral-500 dark:text-neutral-400">Total size</p>
          <p className="mt-1 font-semibold text-neutral-950 dark:text-neutral-100">{summary.totalChars.toLocaleString()} chars</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
          <p className="text-neutral-500 dark:text-neutral-400">Largest</p>
          <p className="mt-1 truncate font-semibold text-neutral-950 dark:text-neutral-100">{summary.largestName}</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-xl border border-black/8 bg-white p-2 dark:border-white/10 dark:bg-slate-900/80">
          {(contextPayload.sources.length > 0 ? contextPayload.sources : []).map((source, index) => (
            <button
              key={`${source.name}-${index}`}
              type="button"
              onClick={() => setSelectedSourceIndex(index)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                index === safeSelectedIndex
                  ? "border-blue-300 bg-blue-50 text-blue-900"
                  : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
              }`}
            >
              <p className="truncate font-medium">{source.name}</p>
              <p className="mt-1 text-[11px] opacity-80">
                {source.type} · {sourceSize(source).toLocaleString()} chars
              </p>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-black/8 bg-slate-950 p-3 text-xs text-slate-100 dark:border-white/10">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">
            {selectedSource ? selectedSource.name : "Source Content"}
          </p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">
            {selectedSource?.content ?? "Select a source to inspect its content."}
          </pre>
        </div>
      </div>

      <div className="rounded-xl border border-black/8 bg-slate-950 p-3 text-xs text-slate-100 dark:border-white/10">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Final Prompt Sent to Model</p>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">{contextPayload.finalPrompt}</pre>
      </div>
    </div>
  );
}
