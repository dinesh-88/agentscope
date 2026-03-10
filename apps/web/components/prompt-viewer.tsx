"use client";

import { useMemo } from "react";
import { Binary, MessagesSquare, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";

type PromptViewerProps = {
  artifacts: Artifact[];
};

function toPrettyText(value: unknown) {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function PromptViewer({ artifacts }: PromptViewerProps) {
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const promptArtifact = useMemo(() => {
    const promptArtifacts = artifacts.filter((artifact) => artifact.kind === "llm.prompt");
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
  const prompt = payload.prompt ?? payload.input ?? payload.messages ?? payload.payload ?? payload;
  const messageCount = Array.isArray(payload.messages) ? payload.messages.length : 0;

  return (
    <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="size-4 text-cyan-600" />
          Prompt viewer
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
              <MessagesSquare className="size-3.5" />
              Messages
            </div>
            <div className="text-2xl font-semibold text-slate-950">{messageCount}</div>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
              <Binary className="size-3.5" />
              Artifact kind
            </div>
            <div className="text-lg font-semibold text-slate-950">{promptArtifact.kind}</div>
          </div>
        </div>

        <pre className="max-h-52 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
          {toPrettyText(prompt)}
        </pre>

        <Dialog>
          <DialogTrigger render={<Button variant="outline" className="border-slate-300 bg-white" />}>
            Open full payload
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Prompt artifact payload</DialogTitle>
              <DialogDescription>
                Full JSON payload for the selected `llm.prompt` artifact.
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-[70vh] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
              {JSON.stringify(promptArtifact.payload, null, 2)}
            </pre>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
