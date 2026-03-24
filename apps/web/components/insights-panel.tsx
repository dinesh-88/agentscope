import { AlertTriangle, Sparkles } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunInsight } from "@/lib/api";

type InsightsPanelProps = {
  insights: RunInsight[];
};

const CONTEXT_INSIGHT_TYPES = new Set([
  "CONTEXT_BLOAT",
  "DOMINANT_CONTEXT_SOURCE",
  "CONTEXT_REDUNDANCY",
  "MISSING_CONTEXT",
  "PROMPT_WITH_CONTEXT_TOO_LARGE",
  "CONTEXT_TOO_LARGE",
  "CONTEXT_TRUNCATED",
  "CONTEXT_LIKELY_CAUSED_FAILURE",
  "STEP_TRANSITION_ISSUE",
]);
const INSTRUCTION_INSIGHT_TYPES = new Set([
  "INSTRUCTION_CONFLICT",
  "MISSING_INSTRUCTIONS",
  "INSTRUCTION_DRIFT",
]);

function severityTone(severity: string) {
  if (severity === "high") return "bg-rose-100 text-rose-700";
  if (severity === "medium") return "bg-amber-100 text-amber-700";
  return "bg-cyan-100 text-cyan-700";
}

function structuredCause(insight: RunInsight) {
  return insight.cause || insight.message;
}

function structuredImpact(insight: RunInsight) {
  return insight.impact || "This issue affected run quality and reliability.";
}

function structuredFix(insight: RunInsight) {
  if (insight.fix && insight.fix.length > 0) return insight.fix;
  if (insight.recommendation) return [insight.recommendation];
  return ["Inspect failing spans and apply targeted validation before the next step."];
}

function renderStructuredInsight(insight: RunInsight) {
  return (
    <>
      <p className="text-sm text-slate-700">
        <span className="font-semibold text-slate-900">Cause: </span>
        {structuredCause(insight)}
      </p>
      <p className="mt-2 text-sm text-slate-700">
        <span className="font-semibold text-slate-900">Impact: </span>
        {structuredImpact(insight)}
      </p>
      <ul className="mt-2 space-y-1 text-sm text-slate-700">
        <li className="font-semibold text-slate-900">Fix:</li>
        {structuredFix(insight).slice(0, 2).map((fixItem) => (
          <li key={fixItem}>- {fixItem}</li>
        ))}
      </ul>
    </>
  );
}

export function InsightsPanel({ insights }: InsightsPanelProps) {
  const fixSuggestions =
    insights.find((insight) => insight.insight_type === "RUN_SUMMARY" && insight.is_primary)
      ?.fix_suggestions?.slice(0, 3) ??
    insights.find((insight) => insight.insight_type === "RUN_SUMMARY")
      ?.fix_suggestions?.slice(0, 3) ??
    [];
  const contextInsights = insights.filter((insight) => CONTEXT_INSIGHT_TYPES.has(insight.insight_type));
  const instructionInsights = insights.filter((insight) => INSTRUCTION_INSIGHT_TYPES.has(insight.insight_type));
  const otherInsights = insights.filter(
    (insight) =>
      !CONTEXT_INSIGHT_TYPES.has(insight.insight_type) &&
      !INSTRUCTION_INSIGHT_TYPES.has(insight.insight_type),
  );

  return (
    <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-600" />
          Optimization insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {fixSuggestions.length > 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Suggested Fixes</div>
            <div className="space-y-2">
              {fixSuggestions.map((fix, index) => (
                <div
                  key={`${fix.title}-${fix.action_type}`}
                  className={index === 0 ? "rounded-xl border border-emerald-300 bg-white p-3" : "rounded-xl border border-emerald-200/70 bg-white/90 p-3 opacity-90"}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-950">{fix.title}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                      {fix.action_type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700">{fix.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {insights.length === 0 && (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            No prompt insights were generated for this run.
          </div>
        )}

        {contextInsights.length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Context Issues</div>
            <div className="space-y-2">
              {contextInsights.map((insight) => (
                <div key={insight.id} className="rounded-xl border border-slate-200/80 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-950">{insight.title || insight.insight_type}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${severityTone(insight.severity)}`}>
                      {insight.severity}
                    </span>
                  </div>
                  {renderStructuredInsight(insight)}
                </div>
              ))}
            </div>
          </div>
        )}
        {instructionInsights.length > 0 && (
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Instruction Issues</div>
            <div className="space-y-2">
              {instructionInsights.map((insight) => (
                <div key={insight.id} className="rounded-xl border border-slate-200/80 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-950">{insight.title || insight.insight_type}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${severityTone(insight.severity)}`}>
                      {insight.severity}
                    </span>
                  </div>
                  {renderStructuredInsight(insight)}
                </div>
              ))}
            </div>
          </div>
        )}

        {otherInsights.map((insight) => (
          <div key={insight.id} className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-slate-500" />
                <span className="font-medium text-slate-950">{insight.title || insight.insight_type}</span>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${severityTone(insight.severity)}`}>
                {insight.severity}
              </span>
            </div>
            {renderStructuredInsight(insight)}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
