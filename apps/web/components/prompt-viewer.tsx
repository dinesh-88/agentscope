"use client";

import { useMemo } from "react";
import { ScrollText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PromptPayloadPanel } from "@/components/prompt-payload-panel";
import { type Artifact } from "@/lib/api";
import { buildPromptPresentation } from "@/lib/prompt-presentation";
import { useRunDetailStore } from "@/lib/run-detail-store";

type PromptViewerProps = {
  artifacts: Artifact[];
};

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

  const presentation = useMemo(
    () => buildPromptPresentation(promptArtifact?.payload ?? {}),
    [promptArtifact?.payload],
  );

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
          <div className="mb-1 text-xs uppercase tracking-[0.2em] text-neutral-500">Structured Sections</div>
          <div className="text-2xl font-semibold text-neutral-950 dark:text-neutral-100">{presentation.sections.length}</div>
          <div className="mt-1 text-xs text-neutral-500">{promptArtifact.kind}</div>
        </div>

        <PromptPayloadPanel title="Prompt Payload" payload={promptArtifact.payload} variant="light" />
      </CardContent>
    </Card>
  );
}
