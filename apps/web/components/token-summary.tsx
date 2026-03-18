import { Coins, Sigma } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunMetrics } from "@/lib/api";

type TokenSummaryProps = {
  metrics: RunMetrics | null;
};

export function TokenSummary({ metrics }: TokenSummaryProps) {
  const items = [
    ["Input tokens", metrics?.input_tokens ?? 0],
    ["Output tokens", metrics?.output_tokens ?? 0],
    ["Total tokens", metrics?.total_tokens ?? 0],
  ];

  return (
    <Card className="border border-black/8 shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sigma className="size-4 text-amber-600" />
          Token & Cost Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-black/8 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">{label}</div>
            <div className="mt-2 text-lg font-semibold text-neutral-950 dark:text-neutral-100">{value}</div>
          </div>
        ))}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-amber-700">
            <Coins className="size-3.5" />
            Cost
          </div>
          <div className="mt-2 text-lg font-semibold text-neutral-950 dark:text-neutral-100">
            ${(metrics?.estimated_cost ?? 0).toFixed(6)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
