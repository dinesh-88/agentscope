"use client";

import { useEffect, useMemo, useRef } from "react";

import { API_BASE_URL, UI_SESSION_COOKIE_NAME, type Artifact, type Run, type Span } from "@/lib/api";
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

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const needle = `${name}=`;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(needle)) {
      const value = trimmed.slice(needle.length);
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

type UseRunStreamParams = {
  runId: string;
  initialRun: Run;
  initialSpans: Span[];
  initialArtifacts: Artifact[];
  initialLogs?: RunLog[];
};

const EMPTY_LOGS: RunLog[] = [];

export function useRunStream({
  runId,
  initialRun,
  initialSpans,
  initialArtifacts,
  initialLogs,
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
  const streamUrl = useMemo(() => {
    const base = toWsUrl(API_BASE_URL, `/v1/runs/${runId}/stream`);
    const token = readCookie(UI_SESSION_COOKIE_NAME);
    if (!token) return base;
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}access_token=${encodeURIComponent(token)}`;
  }, [runId]);
  const stableInitialLogs = useMemo(() => initialLogs ?? EMPTY_LOGS, [initialLogs]);

  useEffect(() => {
    setInitialState({
      runId,
      run: initialRun,
      spans: initialSpans,
      artifacts: initialArtifacts,
      logs: stableInitialLogs,
    });
  }, [initialRun, initialSpans, initialArtifacts, stableInitialLogs, runId, setInitialState]);

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
