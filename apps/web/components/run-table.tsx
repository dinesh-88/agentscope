"use client";

import Link from "next/link";
import { ArrowUpRight, Bot, Clock3, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Run } from "@/lib/api";

type RunTableProps = {
  runs: Run[];
};

function formatDate(value: string | null) {
  if (!value) return "In progress";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusPill(status: string) {
  const palette: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700",
    completed: "bg-emerald-100 text-emerald-700",
    running: "bg-amber-100 text-amber-700",
    failed: "bg-rose-100 text-rose-700",
    error: "bg-rose-100 text-rose-700",
  };

  return palette[status] ?? "bg-slate-100 text-slate-700";
}

export function RunTable({ runs }: RunTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-slate-200/80">
          <TableHead>Workflow</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Ended</TableHead>
          <TableHead className="text-right">Open</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id} className="border-slate-200/70">
            <TableCell className="min-w-[220px]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl bg-cyan-100 p-2 text-cyan-700">
                  <Bot className="size-4" />
                </div>
                <div>
                  <div className="font-medium text-slate-950">{run.workflow_name}</div>
                  <div className="max-w-[260px] truncate text-xs text-slate-500">{run.id}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>{run.agent_name}</TableCell>
            <TableCell>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusPill(run.status)}`}>
                {run.status}
              </span>
            </TableCell>
            <TableCell className="text-slate-600">{formatDate(run.started_at)}</TableCell>
            <TableCell className="text-slate-600">
              <span className="inline-flex items-center gap-1">
                {!run.ended_at && <Loader2 className="size-3.5 animate-spin" />}
                {formatDate(run.ended_at)}
              </span>
            </TableCell>
            <TableCell className="text-right">
              <Button
                render={<Link href={`/runs/${run.id}`} />}
                nativeButton={false}
                variant="outline"
                className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
              >
                <Clock3 className="size-4" />
                Inspect
                <ArrowUpRight className="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
