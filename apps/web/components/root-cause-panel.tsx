import { AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunAnalysis, type RunRootCause } from "@/lib/api";

type RootCausePanelProps = {
  analysis: RunAnalysis | null;
  rootCause: RunRootCause | null;
};

export function RootCausePanel({ analysis, rootCause }: RootCausePanelProps) {
  const rootCauseName = rootCause?.root_cause_type ?? analysis?.root_cause_category ?? "Unavailable";
  const confidence = rootCause?.confidence ?? null;
  const evidence = rootCause?.evidence ?? analysis?.evidence ?? null;
  const suggestedFix =
    rootCause?.suggested_fix ??
    (Array.isArray(analysis?.suggested_fixes) ? String(analysis?.suggested_fixes?.[0] ?? "") : "");
  const summary = rootCause?.message ?? analysis?.summary ?? "No root cause analysis has been generated.";

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertCircle className="size-4 text-rose-600" />
          Root Cause Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-rose-700">Root cause</div>
          <div className="mt-2 text-lg font-semibold text-neutral-950 dark:text-neutral-100">{rootCauseName}</div>
          {confidence !== null && (
            <div className="mt-1 text-sm text-rose-800">Confidence {(confidence * 100).toFixed(0)}%</div>
          )}
        </div>
        <div className="rounded-xl border border-black/8 bg-neutral-50 p-4 text-sm text-neutral-800">{summary}</div>
        <div className="rounded-xl border border-black/8 bg-neutral-950 p-4 text-xs leading-6 text-neutral-100">
          <pre className="overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(evidence ?? {}, null, 2)}
          </pre>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          {suggestedFix || "No suggested fix was recorded."}
        </div>
      </CardContent>
    </Card>
  );
}
