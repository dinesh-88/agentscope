"use client";

import { useMemo } from "react";

import { type Span } from "@/lib/api";

type InstructionSource = {
  name: string;
  type: "global" | "local" | "runtime" | string;
  path: string;
  content: string;
  hash: string;
};

type InstructionsTabProps = {
  span: Span | null;
};

function parseInstructionContext(span: Span | null) {
  const raw = span?.instruction_context;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const context = raw as Record<string, unknown>;
  const sources: InstructionSource[] = Array.isArray(context.sources)
    ? context.sources
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "unknown",
          type: typeof entry.type === "string" ? entry.type : "local",
          path: typeof entry.path === "string" ? entry.path : "-",
          content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? "", null, 2),
          hash: typeof entry.hash === "string" ? entry.hash : "-",
        }))
    : [];
  const precedenceStack = Array.isArray(context.precedence_stack)
    ? context.precedence_stack
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
        .map((entry) => ({
          name: typeof entry.name === "string" ? entry.name : "unknown",
          type: typeof entry.type === "string" ? entry.type : "local",
          path: typeof entry.path === "string" ? entry.path : "-",
        }))
    : [];

  return { sources, precedenceStack };
}

function typeTone(type: string) {
  if (type === "runtime") return "bg-amber-100 text-amber-800";
  if (type === "local") return "bg-blue-100 text-blue-800";
  if (type === "global") return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-700";
}

export function InstructionsTab({ span }: InstructionsTabProps) {
  const instructionContext = useMemo(() => parseInstructionContext(span), [span]);

  if (!instructionContext) {
    return (
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-neutral-500 dark:bg-slate-800/70 dark:text-neutral-400">
        No instruction context captured for this span
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Precedence Stack
        </p>
        {instructionContext.precedenceStack.length > 0 ? (
          <ol className="space-y-2">
            {instructionContext.precedenceStack.map((source, index) => (
              <li key={`${source.name}-${index}`} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {index + 1}. {source.name}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeTone(source.type)}`}>{source.type}</span>
                </div>
                <p className="mt-1 text-neutral-500 dark:text-neutral-400">{source.path}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No precedence stack available.</p>
        )}
      </div>

      <div className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-slate-900/80">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
          Instruction Sources
        </p>
        <div className="space-y-2">
          {instructionContext.sources.length > 0 ? (
            instructionContext.sources.map((source, index) => (
              <details key={`${source.hash}-${index}`} className="rounded-lg border border-black/8 bg-slate-50 p-2 dark:border-white/10 dark:bg-slate-800/70">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{source.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeTone(source.type)}`}>{source.type}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{source.path}</p>
                  <p className="mt-1 break-all text-[10px] text-neutral-400 dark:text-neutral-500">{source.hash}</p>
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {source.content}
                </pre>
              </details>
            ))
          ) : (
            <p className="text-sm text-neutral-500 dark:text-neutral-400">No instruction sources loaded.</p>
          )}
        </div>
      </div>
    </div>
  );
}
