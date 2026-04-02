"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";

import { API_BASE_URL, UI_SESSION_COOKIE_NAME } from "@/lib/api";

type RunsAutoRefreshProps = {
  debounceMs?: number;
};

type RunsStreamEvent = {
  type?: string;
};

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

export function RunsAutoRefresh({ debounceMs = 500 }: RunsAutoRefreshProps) {
  const router = useRouter();
  const reconnectRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const closedRef = useRef(false);
  const streamUrl = useMemo(() => {
    const base = toWsUrl(API_BASE_URL, "/v1/runs/stream");
    const token = readCookie(UI_SESSION_COOKIE_NAME);
    if (!token) return base;
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}access_token=${encodeURIComponent(token)}`;
  }, []);

  useEffect(() => {
    closedRef.current = false;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        router.refresh();
      }, debounceMs);
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
          const parsed = JSON.parse(event.data) as RunsStreamEvent;
          if (parsed?.type === "run_upsert") {
            scheduleRefresh();
          }
        } catch {
          // Ignore malformed payloads.
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (closedRef.current) return;
        const attempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = attempt;
        const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt, 5));
        reconnectRef.current = window.setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectRef.current !== null) {
        window.clearTimeout(reconnectRef.current);
      }
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      if (socketRef.current && socketRef.current.readyState < WebSocket.CLOSING) {
        socketRef.current.close();
      }
    };
  }, [debounceMs, router, streamUrl]);

  return null;
}
