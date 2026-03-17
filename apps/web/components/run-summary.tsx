import { Clock3, PlayCircle, ShieldCheck, Workflow } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Run } from "@/lib/api";

type RunSummaryProps = {
  run: Run;
};

function formatDate(value: string | null) {
  if (!value) return "In progress";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const deltaMs = Math.max(end - start, 0);
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function RunSummary({ run }: RunSummaryProps) {
  const items = [
    { label: "Workflow", value: run.workflow_name, icon: Workflow },
    { label: "Agent", value: run.agent_name, icon: ShieldCheck },
    { label: "Status", value: run.status, icon: PlayCircle },
    { label: "Duration", value: formatDuration(run.started_at, run.ended_at), icon: Clock3 },
    { label: "Started", value: formatDate(run.started_at), icon: Clock3 },
    { label: "Ended", value: formatDate(run.ended_at), icon: Clock3 },
  ];

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle>Run Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-black/8 bg-neutral-50 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-neutral-500">
              <Icon className="size-3.5" />
              {label}
            </div>
            <div className="text-sm font-medium text-neutral-950">{value}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
