"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Artifact } from "@/lib/api";
import { useRunDetailStore } from "@/lib/run-detail-store";

type ArtifactViewerProps = {
  artifacts: Artifact[];
};

function renderPayload(artifact: Artifact) {
  return JSON.stringify(artifact.payload, null, 2);
}

export function ArtifactViewer({ artifacts }: ArtifactViewerProps) {
  const selectedSpanId = useRunDetailStore((state) => state.selectedSpanId);
  const scopedArtifacts = useMemo(() => {
    const spanArtifacts = artifacts.filter((artifact) => artifact.span_id === selectedSpanId);
    return spanArtifacts.length > 0 ? spanArtifacts : artifacts;
  }, [artifacts, selectedSpanId]);

  const interestingKinds = ["llm.response", "tool.input", "tool.output", "file.diff", "command.stdout", "command.stderr"];
  const visibleArtifacts = scopedArtifacts.filter((artifact) => interestingKinds.includes(artifact.kind));

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle>Artifacts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visibleArtifacts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/10 bg-neutral-50 p-4 text-sm text-neutral-500">
            No renderable artifacts were found for the selected span.
          </div>
        ) : (
          visibleArtifacts.map((artifact) => (
            <div key={artifact.id} className="rounded-xl border border-black/8">
              <div className="border-b border-black/8 bg-neutral-50 px-4 py-3 text-xs uppercase tracking-[0.2em] text-neutral-500">
                {artifact.kind}
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 text-neutral-900">
                {renderPayload(artifact)}
              </pre>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
