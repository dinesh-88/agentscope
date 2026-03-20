"use client";

import { create } from "zustand";

import type { Artifact, Run, Span } from "@/lib/api";

export type RunLog = {
  id: string;
  run_id: string;
  span_id: string | null;
  level: string;
  message: string;
  timestamp: string | null;
  metadata: Record<string, unknown> | null;
};

export type RunStreamEvent = {
  type: string;
  data: Record<string, unknown>;
};

type RunDetailState = {
  run: Run | null;
  spans: Span[];
  logs: RunLog[];
  artifacts: Artifact[];
  activeSpanId: string | null;
  selectedSpanId: string | null;
  runId: string | null;
  seenEventIds: string[];
  setInitialState: (state: {
    runId: string;
    run: Run;
    spans: Span[];
    artifacts: Artifact[];
    logs?: RunLog[];
  }) => void;
  upsertSpan: (span: Span) => void;
  addLog: (log: RunLog) => void;
  addArtifact: (artifact: Artifact) => void;
  setRunStatus: (status: string, endedAt?: string | null) => void;
  setSelectedSpanId: (spanId: string | null) => void;
  applyEvents: (events: RunStreamEvent[]) => void;
};

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...list, item];
  const next = [...list];
  next[index] = { ...next[index], ...item };
  return next;
}

function normalizeLog(value: unknown): RunLog | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.run_id !== "string") return null;

  return {
    id: entry.id,
    run_id: entry.run_id,
    span_id: typeof entry.span_id === "string" ? entry.span_id : null,
    level: typeof entry.level === "string" ? entry.level : "info",
    message: typeof entry.message === "string" ? entry.message : JSON.stringify(entry.message ?? ""),
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
    metadata:
      entry.metadata && typeof entry.metadata === "object" ? (entry.metadata as Record<string, unknown>) : null,
  };
}

function pushEventId(ids: string[], eventId: string): string[] {
  if (ids.includes(eventId)) return ids;
  const next = [...ids, eventId];
  if (next.length <= 5000) return next;
  return next.slice(next.length - 5000);
}

export const useRunDetailStore = create<RunDetailState>((set) => ({
  run: null,
  spans: [],
  logs: [],
  artifacts: [],
  activeSpanId: null,
  selectedSpanId: null,
  runId: null,
  seenEventIds: [],
  setInitialState: ({ runId, run, spans, artifacts, logs }) =>
    set({
      runId,
      run,
      spans: [...spans].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at)),
      artifacts: [...artifacts],
      logs: [...(logs ?? [])].slice(-500),
      activeSpanId: spans.find((span) => span.status === "running")?.id ?? null,
      selectedSpanId: spans[0]?.id ?? null,
      seenEventIds: [],
    }),
  upsertSpan: (span) =>
    set((state) => {
      const spans = upsertById(state.spans, span).sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at));
      const activeSpanId = spans.find((entry) => entry.status === "running")?.id ?? state.activeSpanId;
      const selectedSpanId = state.selectedSpanId ?? spans[0]?.id ?? null;
      return { spans, activeSpanId, selectedSpanId };
    }),
  addLog: (log) =>
    set((state) => {
      if (state.logs.some((entry) => entry.id === log.id)) return state;
      return { logs: [...state.logs, log].slice(-500) };
    }),
  addArtifact: (artifact) =>
    set((state) => {
      if (state.artifacts.some((entry) => entry.id === artifact.id)) return state;
      return { artifacts: [...state.artifacts, artifact] };
    }),
  setRunStatus: (status, endedAt = null) =>
    set((state) => {
      if (!state.run) return state;
      return { run: { ...state.run, status, ended_at: endedAt ?? state.run.ended_at } };
    }),
  setSelectedSpanId: (selectedSpanId) => set({ selectedSpanId }),
  applyEvents: (events) =>
    set((state) => {
      let nextRun = state.run;
      let nextSpans = state.spans;
      let nextArtifacts = state.artifacts;
      let nextLogs = state.logs;
      let nextActiveSpanId = state.activeSpanId;
      let seenEventIds = state.seenEventIds;

      for (const event of events) {
        const eventId = typeof event.data?.event_id === "string" ? event.data.event_id : null;
        if (eventId && seenEventIds.includes(eventId)) {
          continue;
        }
        if (eventId) {
          seenEventIds = pushEventId(seenEventIds, eventId);
        }

        if (event.type === "init") {
          const run = event.data?.run as Run | undefined;
          const spans = event.data?.spans as Span[] | undefined;
          const artifacts = event.data?.artifacts as Artifact[] | undefined;
          const logs = Array.isArray(event.data?.logs)
            ? event.data.logs.map(normalizeLog).filter(Boolean)
            : [];
          if (run) nextRun = run;
          if (spans) nextSpans = [...spans].sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at));
          if (artifacts) nextArtifacts = [...artifacts];
          if (logs.length > 0) nextLogs = logs.slice(-500) as RunLog[];
          nextActiveSpanId = nextSpans.find((span) => span.status === "running")?.id ?? nextActiveSpanId;
          continue;
        }

        if (
          event.type === "span_started" ||
          event.type === "span_updated" ||
          event.type === "span_completed"
        ) {
          const span = event.data?.span as Span | undefined;
          if (span) {
            nextSpans = upsertById(nextSpans, span).sort((a, b) => +new Date(a.started_at) - +new Date(b.started_at));
            nextActiveSpanId = nextSpans.find((entry) => entry.status === "running")?.id ?? null;
          }
          continue;
        }

        if (event.type === "artifact_created") {
          const artifact = event.data?.artifact as Artifact | undefined;
          if (artifact && !nextArtifacts.some((entry) => entry.id === artifact.id)) {
            nextArtifacts = [...nextArtifacts, artifact];
          }
          continue;
        }

        if (event.type === "log") {
          const log = normalizeLog(event.data?.log);
          if (log && !nextLogs.some((entry) => entry.id === log.id)) {
            nextLogs = [...nextLogs, log].slice(-500);
          }
          continue;
        }

        if (event.type === "run_completed") {
          const run = event.data?.run as Run | undefined;
          if (run) {
            nextRun = run;
          } else if (nextRun) {
            nextRun = { ...nextRun, status: "completed" };
          }
        }
      }

      return {
        run: nextRun,
        spans: nextSpans,
        logs: nextLogs,
        artifacts: nextArtifacts,
        activeSpanId: nextActiveSpanId,
        seenEventIds,
      };
    }),
}));

