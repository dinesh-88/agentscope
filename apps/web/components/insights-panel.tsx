import { AlertTriangle, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunInsight } from "@/lib/api";

type InsightsPanelProps = {
  insights: RunInsight[];
};

function severityTone(severity: string) {
  if (severity === "high") return "bg-rose-100 text-rose-700";
  if (severity === "medium") return "bg-amber-100 text-amber-700";
  return "bg-cyan-100 text-cyan-700";
}

export function InsightsPanel({ insights }: InsightsPanelProps) {
  return (
    <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-600" />
          Optimization insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.length === 0 && (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            No prompt insights were generated for this run.
          </div>
        )}

        {insights.map((insight) => (
          <div key={insight.id} className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-slate-500" />
                <span className="font-medium text-slate-950">{insight.insight_type}</span>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${severityTone(insight.severity)}`}>
                {insight.severity}
              </span>
            </div>
            <p className="text-sm text-slate-700">{insight.message}</p>
            <p className="mt-2 text-sm text-slate-500">{insight.recommendation}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
