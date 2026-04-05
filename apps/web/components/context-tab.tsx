"use client";

import { useMemo } from "react";

import { PromptPayloadPanel } from "@/components/prompt-payload-panel";
import { type Artifact, type Span } from "@/lib/api";

type SpanContextPayload = {
  messages: unknown[];
  systemPrompt: string;
  variables: Record<string, unknown>;
  toolsAvailable: unknown[];
  diff: {
    addedMessages: string[];
    removedMessages: string[];
    changedVariables: {
      added: string[];
      removed: string[];
      changed: string[];
    };
  };
  truncation: {
    contextShrankUnexpectedly: boolean;
    tokensNearLimit: boolean;
  };
};

type ContextTabProps = {
  span: Span | null;
  previousSpan: Span | null;
  artifact: Artifact | null;
};

function toFinalPromptPayload(artifact: Artifact | null): unknown {
  if (!artifact || artifact.kind !== "llm.context") {
    return null;
  }
  const root = artifact.payload;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  return data.final_prompt ?? null;
}

function parseSpanContext(span: Span | null): SpanContextPayload | null {
  const rawContext = span?.context;
  if (!rawContext || typeof rawContext !== "object") {
    return null;
  }

  const context = rawContext as Record<string, unknown>;
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const systemPrompt = typeof context.system_prompt === "string" ? context.system_prompt : "";
  const variables =
    context.variables && typeof context.variables === "object" && !Array.isArray(context.variables)
      ? (context.variables as Record<string, unknown>)
      : {};
  const toolsAvailable = Array.isArray(context.tools_available) ? context.tools_available : [];
  const rawDiff =
    context.diff && typeof context.diff === "object" && !Array.isArray(context.diff)
      ? (context.diff as Record<string, unknown>)
      : {};
  const rawChangedVariables =
    rawDiff.changed_variables &&
    typeof rawDiff.changed_variables === "object" &&
    !Array.isArray(rawDiff.changed_variables)
      ? (rawDiff.changed_variables as Record<string, unknown>)
      : {};
  const rawTruncation =
    context.truncation && typeof context.truncation === "object" && !Array.isArray(context.truncation)
      ? (context.truncation as Record<string, unknown>)
      : {};

  return {
    messages,
    systemPrompt,
    variables,
    toolsAvailable,
    diff: {
      addedMessages: Array.isArray(rawDiff.added_messages)
        ? rawDiff.added_messages.map((entry) => String(entry))
        : [],
      removedMessages: Array.isArray(rawDiff.removed_messages)
        ? rawDiff.removed_messages.map((entry) => String(entry))
        : [],
      changedVariables: {
        added: Array.isArray(rawChangedVariables.added)
          ? rawChangedVariables.added.map((entry) => String(entry))
          : [],
        removed: Array.isArray(rawChangedVariables.removed)
          ? rawChangedVariables.removed.map((entry) => String(entry))
          : [],
        changed: Array.isArray(rawChangedVariables.changed)
          ? rawChangedVariables.changed.map((entry) => String(entry))
          : [],
      },
    },
    truncation: {
      contextShrankUnexpectedly: rawTruncation.context_shrank_unexpectedly === true,
      tokensNearLimit: rawTruncation.tokens_near_limit === true,
    },
  };
}

function stringifyValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function severityTone(usagePercent: number) {
  if (usagePercent >= 95) return "bg-rose-500";
  if (usagePercent >= 80) return "bg-amber-500";
  return "bg-emerald-500";
}

export function ContextTab({ span, previousSpan, artifact }: ContextTabProps) {
  const context = useMemo(() => parseSpanContext(span), [span]);
  const finalPromptPayload = useMemo(() => toFinalPromptPayload(artifact), [artifact]);
  const usagePercent = typeof span?.context_usage_percent === "number" ? span.context_usage_percent : null;

  if (!context) {
    return (
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-neutral-500 dark:bg-slate-800/70 dark:text-neutral-400">
        No context captured for this span
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <div className="mb-2 flex items-center justify-between text-xs">
          <p className="font-medium text-neutral-800 dark:text-neutral-200">Context Usage</p>
          <p className="text-neutral-500 dark:text-neutral-400">
            {span?.context_tokens ?? 0} / {span?.context_window ?? "?"} tokens
            {usagePercent !== null ? ` (${usagePercent.toFixed(1)}%)` : ""}
          </p>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className={`h-full ${severityTone(usagePercent ?? 0)}`}
            style={{ width: `${Math.max(0, Math.min(100, usagePercent ?? 0))}%` }}
          />
        </div>
        {(usagePercent ?? 0) >= 80 ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Warning: context usage is above 80%.</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          System Prompt
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
          {context.systemPrompt || "No system prompt captured"}
        </pre>
      </div>

      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Messages
        </p>
        <div className="max-h-56 space-y-2 overflow-auto">
          {context.messages.length > 0 ? (
            context.messages.map((message, index) => (
              <pre key={index} className="whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {stringifyValue(message)}
              </pre>
            ))
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">No messages captured</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Variables
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
          {JSON.stringify(context.variables, null, 2)}
        </pre>
      </div>

      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Context Diff {previousSpan ? "(vs previous span)" : ""}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/70">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">Added Messages</p>
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300">
              {JSON.stringify(context.diff.addedMessages, null, 2)}
            </pre>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/70">
            <p className="font-medium text-rose-700 dark:text-rose-300">Removed Messages</p>
            <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300">
              {JSON.stringify(context.diff.removedMessages, null, 2)}
            </pre>
          </div>
        </div>
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/70">
          <p className="font-medium text-neutral-800 dark:text-neutral-200">Changed Variables</p>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-neutral-700 dark:text-neutral-300">
            {JSON.stringify(context.diff.changedVariables, null, 2)}
          </pre>
        </div>
        {context.truncation.contextShrankUnexpectedly || context.truncation.tokensNearLimit ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {context.truncation.contextShrankUnexpectedly ? "Context shrank unexpectedly. " : ""}
            {context.truncation.tokensNearLimit ? "Tokens are near the model context limit." : ""}
          </p>
        ) : null}
      </div>

      {finalPromptPayload !== null ? (
        <PromptPayloadPanel title="Final Prompt Sent to Model" payload={finalPromptPayload} variant="light" />
      ) : null}
    </div>
  );
}
