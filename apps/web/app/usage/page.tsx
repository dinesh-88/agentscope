"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, getProjectUsage, type ProjectUsagePoint } from "@/lib/api";

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

export default function UsagePage() {
  const [usage, setUsage] = useState<ProjectUsagePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getCurrentUser();
        const projectId = me.onboarding.default_project_id;
        if (!projectId) return;
        const rows = await getProjectUsage(projectId);
        if (!cancelled) setUsage(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(() => {
    return usage.reduce(
      (acc, item) => {
        acc.tokens += item.tokens;
        acc.cost += item.cost;
        acc.errors += item.errors;
        return acc;
      },
      { tokens: 0, cost: 0, errors: 0 },
    );
  }, [usage]);

  return (
    <AppShell activePath="/usage">
      <section className="space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-950 dark:text-neutral-100">Usage</h1>
          <p className="text-sm text-neutral-600">Token and cost trends over time.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
              <CardContent className="py-5">
                <p className="text-xs text-neutral-500">Total Tokens</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-950 dark:text-neutral-100">{totals.tokens.toLocaleString()}</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
              <CardContent className="py-5">
                <p className="text-xs text-neutral-500">Total Cost</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-950 dark:text-neutral-100">${totals.cost.toFixed(2)}</p>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
              <CardContent className="py-5">
                <p className="text-xs text-neutral-500">Errors</p>
                <p className="mt-1 text-2xl font-semibold text-neutral-950 dark:text-neutral-100">{totals.errors}</p>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
            <CardHeader>
              <CardTitle>Token Usage</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {loading ? <p className="text-sm text-neutral-500">Loading usage data...</p> : null}
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usage}>
                  <defs>
                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e8edf4" />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: "#6b7280", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} />
                  <Tooltip
                    labelFormatter={(label) => formatShortDate(String(label))}
                    formatter={(value) => [Number(value).toLocaleString(), "Tokens"]}
                  />
                  <Area type="monotone" dataKey="tokens" stroke="#2563eb" fill="url(#tokenGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
            <CardHeader>
              <CardTitle>Cost Over Time</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usage}>
                  <defs>
                    <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0f766e" stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="#e8edf4" />
                  <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: "#6b7280", fontSize: 12 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 12 }} tickFormatter={(value) => `$${Number(value).toFixed(2)}`} />
                  <Tooltip
                    labelFormatter={(label) => formatShortDate(String(label))}
                    formatter={(value) => [`$${Number(value).toFixed(4)}`, "Cost"]}
                  />
                  <Area type="monotone" dataKey="cost" stroke="#0f766e" fill="url(#costGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
