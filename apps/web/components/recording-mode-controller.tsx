"use client";

import { useEffect, useState } from "react";

const RECORDING_MODE_KEY = "agentscope-recording-mode";
const RECORDING_MODE_EVENT = "agentscope:recording-mode";

function isTruthy(value: string | null) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function applyRecordingMode(enabled: boolean) {
  document.documentElement.dataset.recordingMode = enabled ? "true" : "false";
  document.body.dataset.recordingMode = enabled ? "true" : "false";
}

function readRecordingModeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("recording")) return null;
  return isTruthy(params.get("recording")) ? "true" : "false";
}

function readStoredRecordingMode() {
  return window.localStorage.getItem(RECORDING_MODE_KEY);
}

export function RecordingModeController() {
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const fromUrl = readRecordingModeFromUrl();
    const fromStorage = readStoredRecordingMode();
    return (fromUrl ?? fromStorage ?? "false") === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(RECORDING_MODE_KEY, enabled ? "true" : "false");
    applyRecordingMode(enabled);
    window.dispatchEvent(new Event(RECORDING_MODE_EVENT));
  }, [enabled]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem(RECORDING_MODE_KEY, next ? "true" : "false");
    applyRecordingMode(next);
    window.dispatchEvent(new Event(RECORDING_MODE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      className="fixed bottom-4 right-4 z-[70] rounded-full border border-black/15 bg-white/95 px-4 py-2 text-xs font-semibold tracking-wide text-gray-900 shadow-lg backdrop-blur transition hover:bg-white"
    >
      {enabled ? "Recording Mode: On" : "Recording Mode: Off"}
    </button>
  );
}
