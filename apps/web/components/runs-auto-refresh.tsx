"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type RunsAutoRefreshProps = {
  intervalMs?: number;
};

export function RunsAutoRefresh({ intervalMs = 5000 }: RunsAutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, router]);

  return null;
}
