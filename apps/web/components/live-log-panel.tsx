"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { RunLog } from "@/lib/run-detail-store";

type LiveLogPanelProps = {
  logs: RunLog[];
};

export function LiveLogPanel({ logs }: LiveLogPanelProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const ordered = useMemo(() => [...logs], [logs]);

  useEffect(() => {
    if (!autoScroll) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [autoScroll, ordered]);

  return (
    <div className="rounded-xl border border-black/10 bg-slate-950 p-3 text-slate-100">
      <div
        ref={viewportRef}
        className="max-h-72 overflow-y-auto font-mono text-xs"
        onScroll={(event) => {
          const target = event.currentTarget;
          const nearBottom = target.scrollHeight - (target.scrollTop + target.clientHeight) < 24;
          setAutoScroll(nearBottom);
        }}
      >
        {ordered.length === 0 ? (
          <p className="text-slate-400">No live logs yet.</p>
        ) : (
          ordered.map((entry) => (
            <div key={entry.id} className="border-b border-slate-800 py-1.5 last:border-b-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                <span>{entry.level}</span>
                {entry.timestamp ? <span>{entry.timestamp}</span> : null}
                {entry.span_id ? <span>{entry.span_id.slice(0, 8)}</span> : null}
              </div>
              <p className="break-words text-slate-100">{entry.message}</p>
            </div>
          ))
        )}
      </div>
      {!autoScroll ? <p className="pt-2 text-[11px] text-amber-300">Auto-scroll paused</p> : null}
    </div>
  );
}

