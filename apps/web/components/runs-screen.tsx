"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Search, SlidersHorizontal } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { type Run } from "@/lib/api";

type RunsScreenProps = {
  runs: Run[];
  initialFilters?: {
    query?: string;
    status?: string;
    model?: string;
    agent?: string;
    tokens_min?: string;
    tokens_max?: string;
    duration_min_ms?: string;
    duration_max_ms?: string;
    time_from?: string;
    time_to?: string;
  };
};

type RunFilters = {
  query: string;
  status: string;
  model: string;
  agent: string;
  tokens_min: string;
  tokens_max: string;
  duration_min_ms: string;
  duration_max_ms: string;
  time_from: string;
  time_to: string;
};

function durationMs(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(end - start, 0);
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function formatStatus(status: string) {
  const tone: Record<string, string> = {
    completed: "bg-emerald-100 text-emerald-700",
    success: "bg-emerald-100 text-emerald-700",
    running: "bg-blue-100 text-blue-700",
    failed: "bg-rose-100 text-rose-700",
    error: "bg-rose-100 text-rose-700",
  };
  return tone[status] ?? "bg-slate-100 text-slate-700";
}

export function RunsScreen({ runs, initialFilters }: RunsScreenProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<RunFilters>({
    query: initialFilters?.query ?? "",
    status: initialFilters?.status ?? "all",
    model: initialFilters?.model ?? "",
    agent: initialFilters?.agent ?? "",
    tokens_min: initialFilters?.tokens_min ?? "",
    tokens_max: initialFilters?.tokens_max ?? "",
    duration_min_ms: initialFilters?.duration_min_ms ?? "",
    duration_max_ms: initialFilters?.duration_max_ms ?? "",
    time_from: toDateTimeLocal(initialFilters?.time_from),
    time_to: toDateTimeLocal(initialFilters?.time_to),
  });

  const totals = useMemo(() => {
    const tokens = runs.reduce((sum, run) => sum + (run.total_tokens ?? 0), 0);
    const cost = runs.reduce((sum, run) => sum + (run.total_cost_usd ?? 0), 0);
    return { tokens, cost };
  }, [runs]);

  function applyFilters(next: RunFilters) {
    const params = new URLSearchParams();
    if (next.query) params.set("query", next.query);
    if (next.status && next.status !== "all") params.set("status", next.status);
    if (next.model) params.set("model", next.model);
    if (next.agent) params.set("agent", next.agent);
    if (next.tokens_min) params.set("tokens_min", next.tokens_min);
    if (next.tokens_max) params.set("tokens_max", next.tokens_max);
    if (next.duration_min_ms) params.set("duration_min_ms", next.duration_min_ms);
    if (next.duration_max_ms) params.set("duration_max_ms", next.duration_max_ms);
    if (next.time_from) params.set("time_from", new Date(next.time_from).toISOString());
    if (next.time_to) params.set("time_to", new Date(next.time_to).toISOString());

    startTransition(() => {
      router.replace(`/runs${params.size ? `?${params.toString()}` : ""}`);
    });
  }

  return (
    <section className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Runs</h1>
          <p className="text-sm text-neutral-600">Search and monitor each agent execution in one place.</p>
        </div>
        <div className="flex gap-3 text-xs text-neutral-600">
          <span className="rounded-lg bg-white/80 px-3 py-2">{runs.length} runs</span>
          <span className="rounded-lg bg-white/80 px-3 py-2">{totals.tokens.toLocaleString()} tokens</span>
          <span className="rounded-lg bg-white/80 px-3 py-2">${totals.cost.toFixed(2)} cost</span>
        </div>
      </div>

      <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={filters.query}
                onChange={(event) => setFilters((cur) => ({ ...cur, query: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyFilters(filters);
                }}
                placeholder="Search by run name, agent, or id"
                className="h-11 w-full rounded-xl border border-black/10 bg-white pl-10 pr-4 text-sm outline-none transition focus:border-blue-400"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={filters.status}
                onChange={(event) => {
                  const next = { ...filters, status: event.target.value };
                  setFilters(next);
                  applyFilters(next);
                }}
                className="h-11 rounded-xl border border-black/10 bg-white px-3 text-sm"
              >
                <option value="all">All status</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="error">Error</option>
              </select>
              <button
                type="button"
                onClick={() => setShowFilters((current) => !current)}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-3 text-sm"
              >
                <SlidersHorizontal className="size-4" />
                Filters
              </button>
              <button
                type="button"
                onClick={() => applyFilters(filters)}
                disabled={isPending}
                className="h-11 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
              >
                {isPending ? "Applying" : "Apply"}
              </button>
            </div>
          </div>
        </CardHeader>

        {showFilters ? (
          <CardContent className="border-t border-black/5 pb-4 pt-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <input
                value={filters.model}
                onChange={(event) => setFilters((cur) => ({ ...cur, model: event.target.value }))}
                placeholder="Model"
                className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm"
              />
              <input
                value={filters.agent}
                onChange={(event) => setFilters((cur) => ({ ...cur, agent: event.target.value }))}
                placeholder="Agent"
                className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm"
              />
              <input
                value={filters.tokens_min}
                onChange={(event) => setFilters((cur) => ({ ...cur, tokens_min: event.target.value }))}
                type="number"
                min={0}
                placeholder="Min tokens"
                className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm"
              />
              <input
                value={filters.tokens_max}
                onChange={(event) => setFilters((cur) => ({ ...cur, tokens_max: event.target.value }))}
                type="number"
                min={0}
                placeholder="Max tokens"
                className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm"
              />
              <input
                value={filters.duration_min_ms}
                onChange={(event) => setFilters((cur) => ({ ...cur, duration_min_ms: event.target.value }))}
                type="number"
                min={0}
                placeholder="Min duration (ms)"
                className="h-10 rounded-lg border border-black/10 bg-white px-3 text-sm"
              />
            </div>
          </CardContent>
        ) : null}

        <CardContent className="overflow-x-auto pb-4">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-3">Name</th>
                <th className="py-3">Status</th>
                <th className="py-3">Duration</th>
                <th className="py-3">Tokens</th>
                <th className="py-3">Cost</th>
                <th className="py-3">Agent</th>
                <th className="py-3">Open</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, index) => (
                <motion.tr
                  key={run.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.01 }}
                  className="border-b border-black/5 text-sm hover:bg-black/[0.02]"
                >
                  <td className="py-3">
                    <div className="font-medium text-neutral-900">{run.workflow_name}</div>
                    <div className="max-w-[260px] truncate text-xs text-neutral-500">{run.id}</div>
                  </td>
                  <td className="py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${formatStatus(run.status)}`}>{run.status}</span>
                  </td>
                  <td className="py-3 text-neutral-700">{formatDuration(durationMs(run.started_at, run.ended_at))}</td>
                  <td className="py-3 text-neutral-700">{(run.total_tokens ?? 0).toLocaleString()}</td>
                  <td className="py-3 text-neutral-700">${(run.total_cost_usd ?? 0).toFixed(4)}</td>
                  <td className="py-3 text-neutral-700">{run.agent_name}</td>
                  <td className="py-3">
                    <Link href={`/runs/${run.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800">
                      Inspect
                      <ArrowUpRight className="size-4" />
                    </Link>
                  </td>
                </motion.tr>
              ))}

              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-neutral-500">
                    No runs found for current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}

function toDateTimeLocal(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (segment: number) => String(segment).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
