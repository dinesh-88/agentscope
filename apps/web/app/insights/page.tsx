"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle, AlertTriangle, Info, Sparkles } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Severity = "critical" | "warning" | "info";

type Insight = {
  id: string;
  runId: string;
  severity: Severity;
  title: string;
  message: string;
  recommendation: string;
  time: string;
};

const insights: Insight[] = [
  {
    id: "1",
    runId: "run_003",
    severity: "critical",
    title: "Output structure mismatch",
    message: "One run returned malformed JSON and failed downstream validation.",
    recommendation: "Enable strict structured output mode and include one canonical JSON example in the prompt.",
    time: "2026-03-10T07:45:25",
  },
  {
    id: "2",
    runId: "run_008",
    severity: "critical",
    title: "Tool timeout",
    message: "A retrieval tool timed out and interrupted completion.",
    recommendation: "Add retry with exponential backoff and reduce the result set for heavy queries.",
    time: "2026-03-09T20:34:23",
  },
  {
    id: "3",
    runId: "run_002",
    severity: "warning",
    title: "Latency spike",
    message: "LLM response latency exceeded normal range for this workflow.",
    recommendation: "Use a faster model for first pass and reserve larger models for escalation.",
    time: "2026-03-10T09:15:54",
  },
  {
    id: "4",
    runId: "run_004",
    severity: "info",
    title: "Token overhead",
    message: "Prompt size appears larger than required for similar successful runs.",
    recommendation: "Trim static instructions and summarize retrieval chunks before the final model call.",
    time: "2026-03-10T06:12:45",
  },
];

function severityIcon(severity: Severity) {
  if (severity === "critical") return AlertCircle;
  if (severity === "warning") return AlertTriangle;
  return Info;
}

function severityTone(severity: Severity) {
  if (severity === "critical") return "bg-rose-100 text-rose-700";
  if (severity === "warning") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

export default function InsightsPage() {
  const summary = {
    critical: insights.filter((item) => item.severity === "critical").length,
    warning: insights.filter((item) => item.severity === "warning").length,
    info: insights.filter((item) => item.severity === "info").length,
  };
  const summaryCards: { label: string; value: number; severity: Severity }[] = [
    { label: "Critical", value: summary.critical, severity: "critical" },
    { label: "Warning", value: summary.warning, severity: "warning" },
    { label: "Info", value: summary.info, severity: "info" },
  ];

  return (
    <AppShell activePath="/insights">
      <section className="space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Insights</h1>
          <p className="text-sm text-neutral-600">Actionable recommendations to improve reliability, speed, and cost.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {summaryCards.map(({ label, value, severity }, index) => {
            const Icon = severityIcon(severity);
            return (
              <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
                  <CardContent className="flex items-center justify-between py-5">
                    <div>
                      <p className="text-xs text-neutral-500">{label}</p>
                      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
                    </div>
                    <div className={`grid size-10 place-content-center rounded-xl ${severityTone(severity)}`}>
                      <Icon className="size-5" />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-600" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            {insights.map((item, index) => {
              const Icon = severityIcon(item.severity);
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="rounded-xl border border-black/8 bg-white p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className="size-4 text-neutral-500" />
                      <p className="font-medium text-neutral-900">{item.title}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${severityTone(item.severity)}`}>
                      {item.severity}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-700">{item.message}</p>
                  <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-neutral-700">{item.recommendation}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                    <span>{new Date(item.time).toLocaleString()}</span>
                    <Link href={`/runs/${item.runId}`} className="text-blue-700 hover:text-blue-800">
                      Open run
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
