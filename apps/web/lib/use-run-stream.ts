"use client";

import { useEffect, useMemo, useRef } from "react";

import { API_BASE_URL, type Artifact, type Run, type Span } from "@/lib/api";
import { useRunDetailStore, type RunLog, type RunStreamEvent } from "@/lib/run-detail-store";

function toWsUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}${path}`;
  }
  if (normalized.startsWith("http://")) {
    return `ws://${normalized.slice("http://".length)}${path}`;
  }
  return `ws://${normalized}${path}`;
}

type UseRunStreamParams = {
  runId: string;
  initialRun: Run;
  initialSpans: Span[];
  initialArtifacts: Artifact[];
  initialLogs?: RunLog[];
};

export function useRunStream({
  runId,
  initialRun,
  initialSpans,
  initialArtifacts,
  initialLogs = [],
}: UseRunStreamParams) {
  const setInitialState = useRunDetailStore((state) => state.setInitialState);
  const applyEvents = useRunDetailStore((state) => state.applyEvents);
  const queueRef = useRef<RunStreamEvent[]>([]);
  const timerRef = useRef<number | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const closedRef = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const streamUrl = useMemo(() => toWsUrl(API_BASE_URL, `/v1/runs/${runId}/stream`), [runId]);

  useEffect(() => {
    setInitialState({
      runId,
      run: initialRun,
      spans: initialSpans,
      artifacts: initialArtifacts,
      logs: initialLogs,
    });
  }, [initialRun, initialSpans, initialArtifacts, initialLogs, runId, setInitialState]);

  useEffect(() => {
    closedRef.current = false;

    const flushQueue = () => {
      if (queueRef.current.length === 0) return;
      const batch = queueRef.current.splice(0, queueRef.current.length);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        applyEvents(batch);
        rafRef.current = null;
      });
    };

    const scheduleFlush = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flushQueue();
      }, 100);
    };

    const connect = () => {
      if (closedRef.current) return;
      const socket = new WebSocket(streamUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptRef.current = 0;
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as RunStreamEvent;
          queueRef.current.push(parsed);
          scheduleFlush();
        } catch {
          // Ignore malformed event payloads.
        }
      };

      socket.onclose = () => {
        if (closedRef.current) return;
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5));
        reconnectRef.current = window.setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) {
        socketRef.current.close();
      }
    };
  }, [applyEvents, streamUrl]);
}

