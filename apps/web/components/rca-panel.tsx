import { Bug, ShieldAlert } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunRootCause } from "@/lib/api";

type RcaPanelProps = {
  rootCause: RunRootCause | null;
};

export function RcaPanel({ rootCause }: RcaPanelProps) {
  return (
    <Card className="rounded-3xl border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-rose-600" />
          Root cause analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!rootCause && (
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
            No root cause classification was stored for this run.
          </div>
        )}

        {rootCause && (
          <>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 p-4">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-rose-500">Classification</div>
                <div className="mt-1 text-lg font-semibold text-slate-950">{rootCause.root_cause_type}</div>
              </div>
              <div className="rounded-full bg-white px-3 py-1 text-sm font-medium text-rose-700">
                {(rootCause.confidence * 100).toFixed(0)}% confidence
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2 font-medium text-slate-950">
                <Bug className="size-4 text-rose-600" />
                Evidence
              </div>
              <p className="mb-3 text-sm text-slate-700">{rootCause.message}</p>
              <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                {JSON.stringify(rootCause.evidence, null, 2)}
              </pre>
            </div>

            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-950">
              <div className="mb-1 text-xs uppercase tracking-[0.24em] text-cyan-700">Suggested fix</div>
              {rootCause.suggested_fix}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
