"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, Clock3, DollarSign } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type Run } from "@/lib/api";

function durationMs(run: Run) {
  const start = new Date(run.started_at).getTime();
  const end = run.ended_at ? new Date(run.ended_at).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

export function DashboardView({ runs }: { runs: Run[] }) {
  const stats = useMemo(() => {
    const failures = runs.filter((run) => run.status === "failed" || run.status === "error").length;
    const avgLatencyMs = runs.length > 0 ? runs.reduce((sum, run) => sum + durationMs(run), 0) / runs.length : 0;
    const totalCost = runs.reduce((sum, run) => sum + (run.total_cost_usd ?? 0), 0);
    return {
      runs: runs.length,
      failures,
      avgLatencyMs,
      totalCost,
    };
  }, [runs]);

  const runsByDay = useMemo(() => {
    const buckets = new Map<string, { date: string; runs: number; cost: number }>();
    for (const run of runs) {
      const key = new Date(run.started_at).toISOString().slice(0, 10);
      const current = buckets.get(key) ?? { date: key, runs: 0, cost: 0 };
      current.runs += 1;
      current.cost += run.total_cost_usd ?? 0;
      buckets.set(key, current);
    }
    return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  }, [runs]);

  const metrics = [
    { label: "Total Runs", value: stats.runs.toLocaleString(), icon: Activity, tone: "text-blue-700 bg-blue-100" },
    { label: "Failures", value: stats.failures.toLocaleString(), icon: AlertTriangle, tone: "text-rose-700 bg-rose-100" },
    { label: "Avg Latency", value: `${Math.round(stats.avgLatencyMs)} ms`, icon: Clock3, tone: "text-amber-700 bg-amber-100" },
    { label: "Total Cost", value: `$${stats.totalCost.toFixed(2)}`, icon: DollarSign, tone: "text-emerald-700 bg-emerald-100" },
  ];

  return (
    <section className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Dashboard</h1>
        <p className="text-sm text-neutral-600">A clear view of activity, reliability, and spend.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="border border-black/5 bg-white/80 py-0 shadow-sm">
                <CardContent className="flex items-center justify-between py-5">
                  <div>
                    <p className="text-sm text-neutral-500">{metric.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-neutral-900">{metric.value}</p>
                  </div>
                  <div className={`grid size-10 place-content-center rounded-xl ${metric.tone}`}>
                    <Icon className="size-5" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border border-black/5 bg-white/80 py-0 shadow-sm">
          <CardHeader>
            <CardTitle>Runs Over Time</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={runsByDay}>
                <defs>
                  <linearGradient id="runsGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#e8edf4" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: "#6b7280", fontSize: 12 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} allowDecimals={false} />
                <Tooltip labelFormatter={(label) => formatShortDate(String(label))} />
                <Area type="monotone" dataKey="runs" stroke="#2563eb" fill="url(#runsGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border border-black/5 bg-white/80 py-0 shadow-sm">
          <CardHeader>
            <CardTitle>Cost Trend</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={runsByDay}>
                <CartesianGrid vertical={false} stroke="#e8edf4" />
                <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: "#6b7280", fontSize: 12 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                <Tooltip
                  labelFormatter={(label) => formatShortDate(String(label))}
                  formatter={(value) => [`$${Number(value).toFixed(3)}`, "Cost"]}
                />
                <Bar dataKey="cost" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
