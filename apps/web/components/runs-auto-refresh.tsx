"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type RunsAutoRefreshProps = {
  intervalMs?: number;
};

const RECORDING_MODE_KEY = "agentscope-recording-mode";
const RECORDING_MODE_EVENT = "agentscope:recording-mode";

export function RunsAutoRefresh({ intervalMs = 5000 }: RunsAutoRefreshProps) {
  const router = useRouter();
  const [resolvedInterval, setResolvedInterval] = useState(intervalMs);

  useEffect(() => {
    const syncInterval = () => {
      const isRecording = window.localStorage.getItem(RECORDING_MODE_KEY) === "true";
      setResolvedInterval(isRecording ? 30000 : intervalMs);
    };

    syncInterval();
    window.addEventListener(RECORDING_MODE_EVENT, syncInterval);
    window.addEventListener("storage", syncInterval);

    return () => {
      window.removeEventListener(RECORDING_MODE_EVENT, syncInterval);
      window.removeEventListener("storage", syncInterval);
    };
  }, [intervalMs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, resolvedInterval);

    return () => window.clearInterval(timer);
  }, [resolvedInterval, router]);

  return null;
}
