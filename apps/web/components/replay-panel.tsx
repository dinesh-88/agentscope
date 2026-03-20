"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type Artifact,
  type ReplayResponse,
  modifyReplay,
  resumeReplay,
  startReplay,
  stepReplay,
} from "@/lib/api";

type ReplayPanelProps = {
  runId: string;
  selectedArtifacts: Artifact[];
};

function formatMode(state: Record<string, unknown> | null | undefined) {
  const mode = typeof state?.mode === "string" ? state.mode : "unknown";
  const status = typeof state?.status === "string" ? state.status : "unknown";
  return `${mode} · ${status}`;
}

export function ReplayPanel({ runId, selectedArtifacts }: ReplayPanelProps) {
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState("");
  const [spanId, setSpanId] = useState("");
  const [kind, setKind] = useState("");
  const [payloadText, setPayloadText] = useState("{\n  \"patched\": true\n}");

  const selectedArtifactOptions = useMemo(
    () => selectedArtifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, spanId: artifact.span_id })),
    [selectedArtifacts],
  );

  async function withAction(action: () => Promise<ReplayResponse>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setReplay(next);
    } catch (value) {
      const message = value instanceof Error ? value.message : "Replay request failed";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function parsePayload() {
    try {
      const parsed = JSON.parse(payloadText) as Record<string, unknown>;
      return parsed;
    } catch {
      throw new Error("Payload must be valid JSON.");
    }
  }

  return (
    <Card className="border border-black/5 bg-white/90 py-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcw className="size-4 text-indigo-600" />
          Replay Engine
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => withAction(() => startReplay({ original_run_id: runId }))}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            Start Replay
          </button>
          <button
            type="button"
            disabled={busy || !replay}
            onClick={() => replay && withAction(() => stepReplay(replay.replay.id))}
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-60 dark:border-white/20 dark:bg-slate-900 dark:text-neutral-100"
          >
            Step
          </button>
          <button
            type="button"
            disabled={busy || !replay}
            onClick={() => replay && withAction(() => resumeReplay(replay.replay.id))}
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-60 dark:border-white/20 dark:bg-slate-900 dark:text-neutral-100"
          >
            Resume
          </button>
        </div>

        {replay ? (
          <div className="rounded-lg border border-black/10 bg-neutral-50 p-3 text-xs text-neutral-700">
            <p>Replay ID: {replay.replay.id}</p>
            <p>
              Progress: {replay.replay.current_step}/{replay.total_steps}
            </p>
            <p>Mode: {formatMode(replay.replay.state as Record<string, unknown>)}</p>
            <p>Active run: {replay.active_run_id}</p>
            {replay.forked_run?.id ? (
              <p>
                Forked run:{" "}
                <Link href={`/runs/${replay.forked_run.id}`} className="text-indigo-700 hover:text-indigo-800">
                  {replay.forked_run.id}
                </Link>
              </p>
            ) : null}
          </div>
        ) : null}

        {replay?.next_step ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-medium">Next step #{replay.next_step.index}</p>
            <p>{replay.next_step.span.name}</p>
            <p>{replay.next_step.artifacts.length} artifact(s)</p>
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border border-black/10 p-3">
          <p className="text-xs font-medium text-neutral-700">Modify artifact payload</p>
          <select
            value={artifactId}
            onChange={(event) => {
              const id = event.target.value;
              setArtifactId(id);
              const selected = selectedArtifactOptions.find((entry) => entry.id === id);
              if (selected) {
                setKind(selected.kind);
                setSpanId(selected.spanId ?? "");
              }
            }}
            className="w-full rounded-md border border-black/10 px-2 py-1.5 text-xs"
          >
            <option value="">Select artifact (optional)</option>
            {selectedArtifactOptions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.kind} · {entry.id.slice(0, 10)}
              </option>
            ))}
          </select>
          <input
            value={spanId}
            onChange={(event) => setSpanId(event.target.value)}
            placeholder="span_id (optional)"
            className="w-full rounded-md border border-black/10 px-2 py-1.5 text-xs"
          />
          <input
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            placeholder="kind (optional)"
            className="w-full rounded-md border border-black/10 px-2 py-1.5 text-xs"
          />
          <textarea
            value={payloadText}
            onChange={(event) => setPayloadText(event.target.value)}
            rows={5}
            className="w-full rounded-md border border-black/10 px-2 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy || !replay}
            onClick={() =>
              replay &&
              withAction(() =>
                modifyReplay(replay.replay.id, {
                  artifact_id: artifactId || undefined,
                  span_id: spanId || undefined,
                  kind: kind || undefined,
                  payload: parsePayload(),
                }),
              )
            }
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
          >
            Apply modification
          </button>
        </div>

        {replay?.diff.modified_artifacts.length ? (
          <div className="space-y-2 rounded-lg border border-black/10 bg-neutral-50 p-3">
            <p className="text-xs font-medium text-neutral-700">Diff</p>
            {replay.diff.modified_artifacts.map((entry) => (
              <div key={entry.artifact_id} className="rounded border border-black/10 bg-white p-2 text-xs">
                <p className="font-medium">{entry.kind}</p>
                <p className="text-neutral-600">{entry.artifact_id}</p>
                <pre className="mt-1 max-h-24 overflow-auto rounded bg-neutral-950 p-2 text-[11px] text-neutral-100">
                  {JSON.stringify(entry.replay_payload, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        ) : null}

        {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
