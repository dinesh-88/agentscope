"use client";

import { useMemo } from "react";
import { MessagesSquare, ScrollText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";

type PromptViewerProps = {
  artifacts: Artifact[];
};

type ChatMessage = {
  role: string;
  content: string;
};

function normalizeMessages(payload: Record<string, unknown>): ChatMessage[] {
  const messages = payload.messages;
  if (Array.isArray(messages)) {
    return messages.map((message) => {
      if (typeof message === "string") {
        return { role: "user", content: message };
      }

      if (message && typeof message === "object") {
        const role = typeof message.role === "string" ? message.role : "user";
        const content =
          typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? message, null, 2);
        return { role, content };
      }

      return { role: "user", content: JSON.stringify(message, null, 2) };
    });
  }

  const fallback = payload.prompt ?? payload.input ?? payload.payload ?? payload;
  return [{ role: "user", content: typeof fallback === "string" ? fallback : JSON.stringify(fallback, null, 2) }];
}

function roleTone(role: string) {
  if (role === "system") return "border-blue-200 bg-blue-50";
  if (role === "assistant") return "border-emerald-200 bg-emerald-50";
  return "border-black/8 bg-neutral-50";
}

export function PromptViewer({ artifacts }: PromptViewerProps) {
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const promptArtifact = useMemo(() => {
    const promptArtifacts = artifacts.filter(
      (artifact) => artifact.kind === "llm.prompt" || artifact.kind === "llm_prompt"
    );
    return (
      promptArtifacts.find((artifact) => artifact.span_id === selectedSpanId) ??
      promptArtifacts[0] ??
      null
    );
  }, [artifacts, selectedSpanId]);

  if (!promptArtifact) {
    return (
      <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-4 text-cyan-600" />
            Prompt viewer
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-500">
          No `llm.prompt` artifacts were available for this run.
        </CardContent>
      </Card>
    );
  }

  const payload = promptArtifact.payload;
  const messages = normalizeMessages(payload);

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4 text-blue-600" />
          Prompt Viewer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-black/8 bg-neutral-50 p-4">
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-neutral-500">
              <MessagesSquare className="size-3.5" />
              Messages
          </div>
          <div className="text-2xl font-semibold text-neutral-950 dark:text-neutral-100">{messages.length}</div>
          <div className="mt-1 text-xs text-neutral-500">{promptArtifact.kind}</div>
        </div>

        <div className="space-y-3">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`rounded-xl border p-4 ${roleTone(message.role)}`}>
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-neutral-600">{message.role}</div>
              <pre className="overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-neutral-900">
                {message.content}
              </pre>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(promptArtifact.payload, null, 2)}
          </pre>
          </div>
      </CardContent>
    </Card>
  );
}
