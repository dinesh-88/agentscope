import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunComparison } from "@/lib/api";
import { parseRunVersion } from "@/lib/run-version";
import { cn } from "@/lib/utils";

type RunCompareViewProps = {
  comparison: RunComparison;
};

type Trend = "improved" | "regressed" | "neutral" | "changed";

function statusScore(status: string) {
  if (status === "success" || status === "completed") return 2;
  if (status === "failed" || status === "error") return 0;
  return 1;
}

function getLatencyMs(startedAt: string, endedAt: string | null) {
  if (!endedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function formatLatency(ms: number | null) {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDelta(delta: number, digits = 0) {
  const fixed = digits > 0 ? Math.abs(delta).toFixed(digits) : Math.abs(delta).toLocaleString();
  if (delta > 0) return `+${fixed}`;
  if (delta < 0) return `-${fixed}`;
  return "0";
}

function metricTone(trend: Trend) {
  if (trend === "improved") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (trend === "regressed") return "border-rose-400/40 bg-rose-500/10 text-rose-200";
  if (trend === "changed") return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  return "border-white/10 bg-white/[0.02] text-gray-200";
}

function TrendBadge({ trend }: { trend: Trend }) {
  const label =
    trend === "improved" ? "Improved" : trend === "regressed" ? "Regressed" : trend === "changed" ? "Changed" : "No change";
  return <span className={cn("rounded-full border px-2 py-0.5 text-xs", metricTone(trend))}>{label}</span>;
}

function verdictTone(winner: "run_a" | "run_b" | "tie") {
  if (winner === "run_b") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (winner === "run_a") return "border-rose-400/40 bg-rose-500/10 text-rose-200";
  return "border-amber-400/30 bg-amber-500/10 text-amber-200";
}

function DiffBlock({ title, left, right }: { title: string; left: string[]; right: string[] }) {
  const leftText = left.join("\n\n").trim();
  const rightText = right.join("\n\n").trim();
  const leftLines = (leftText || "No data").split("\n");
  const rightLines = (rightText || "No data").split("\n");
  const lineCount = Math.max(leftLines.length, rightLines.length);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0f1520]">
      <div className="border-b border-white/10 px-4 py-2.5 text-xs font-medium tracking-wide text-gray-300">{title}</div>
      <div className="grid md:grid-cols-2">
        <div className="border-r border-white/10">
          <div className="border-b border-white/10 bg-rose-500/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-rose-200">Run A</div>
          <div className="max-h-72 overflow-auto">
            {Array.from({ length: lineCount }).map((_, index) => {
              const leftLine = leftLines[index] ?? "";
              const rightLine = rightLines[index] ?? "";
              const changed = leftLine !== rightLine;
              return (
                <div
                  key={`a-${index}-${leftLine.length}`}
                  className={cn("px-3 py-1.5 font-mono text-xs text-gray-300", changed && "bg-rose-500/10 text-rose-100")}
                >
                  {leftLine || " "}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="border-b border-white/10 bg-emerald-500/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
            Run B
          </div>
          <div className="max-h-72 overflow-auto">
            {Array.from({ length: lineCount }).map((_, index) => {
              const leftLine = leftLines[index] ?? "";
              const rightLine = rightLines[index] ?? "";
              const changed = leftLine !== rightLine;
              return (
                <div
                  key={`b-${index}-${rightLine.length}`}
                  className={cn("px-3 py-1.5 font-mono text-xs text-gray-300", changed && "bg-emerald-500/10 text-emerald-100")}
                >
                  {rightLine || " "}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunCompareView({ comparison }: RunCompareViewProps) {
  const runALatency = getLatencyMs(comparison.run_a.started_at, comparison.run_a.ended_at);
  const runBLatency = getLatencyMs(comparison.run_b.started_at, comparison.run_b.ended_at);

  const statusTrend: Trend = comparison.run_a.status === comparison.run_b.status
    ? "neutral"
    : statusScore(comparison.run_b.status) > statusScore(comparison.run_a.status)
      ? "improved"
      : "regressed";

  const latencyTrend: Trend = runALatency === runBLatency
    ? "neutral"
    : runALatency !== null && runBLatency !== null && runBLatency < runALatency
      ? "improved"
      : runALatency !== null && runBLatency !== null
        ? "regressed"
        : "changed";

  const tokensA = comparison.diffs.metrics.run_a.total_tokens;
  const tokensB = comparison.diffs.metrics.run_b.total_tokens;
  const tokenTrend: Trend = tokensA === tokensB ? "neutral" : tokensB < tokensA ? "improved" : "regressed";

  const versionA = parseRunVersion(comparison.run_a);
  const versionB = parseRunVersion(comparison.run_b);
  const winnerLabel = comparison.insights.winner === "run_b" ? "Run B" : comparison.insights.winner === "run_a" ? "Run A" : "Tie";
  const winnerHref =
    comparison.insights.winner === "run_a"
      ? `/runs/${comparison.run_a.id}`
      : comparison.insights.winner === "run_b"
        ? `/runs/${comparison.run_b.id}`
        : "/runs/compare";

  return (
    <div className="space-y-6">
      <Card className="border border-white/10 bg-[#101722] shadow-none">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-gray-100">Comparison Insights</CardTitle>
            <p className="mt-2 text-sm text-gray-300">{comparison.insights.summary}</p>
          </div>
          <div className={cn("inline-flex rounded-full border px-3 py-1 text-xs font-medium", verdictTone(comparison.insights.winner))}>
            {comparison.insights.winner === "tie" ? "⚖️ No winner" : `🏆 ${winnerLabel}`}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Key Changes</div>
              <ul className="mt-3 space-y-2 text-sm text-gray-200">
                {comparison.insights.key_changes.map((change) => (
                  <li
                    key={change}
                    className={cn(
                      "rounded-md border border-white/10 bg-white/[0.03] px-3 py-2",
                      (change.includes("improved") || change.includes("reduced") || change.includes("decreased") || change.includes("resolved")) &&
                        "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
                    )}
                  >
                    {change}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Verdict</div>
                <div className={cn("mt-2 inline-flex rounded-full border px-2.5 py-1 text-sm font-medium", verdictTone(comparison.insights.winner))}>
                  {comparison.insights.verdict}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Recommendation</div>
                <p className="mt-2 text-sm text-gray-200">{comparison.insights.recommendation}</p>
                <Link
                  href={winnerHref}
                  className={cn(
                    "mt-4 inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-colors",
                    comparison.insights.winner === "run_a"
                      ? "border-rose-400/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                      : comparison.insights.winner === "run_b"
                        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                        : "border-amber-400/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20",
                  )}
                >
                  {comparison.insights.winner === "tie" ? "Review both versions" : "Use this version"}
                </Link>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-white/10 bg-[#101722] shadow-none">
        <CardHeader>
          <CardTitle className="text-gray-100">Comparison Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className={cn("rounded-xl border p-4", metricTone(statusTrend))}>
            <div className="text-xs uppercase tracking-[0.18em] text-gray-300">Status</div>
            <div className="mt-2 text-sm text-gray-300">
              {comparison.run_a.status} → {comparison.run_b.status}
            </div>
            <div className="mt-2"><TrendBadge trend={statusTrend} /></div>
          </div>
          <div className={cn("rounded-xl border p-4", metricTone(latencyTrend))}>
            <div className="text-xs uppercase tracking-[0.18em] text-gray-300">Latency</div>
            <div className="mt-2 text-sm text-gray-300">
              {formatLatency(runALatency)} → {formatLatency(runBLatency)}
            </div>
            <div className="mt-2 text-xs text-gray-400">
              Delta {formatDelta((runBLatency ?? 0) - (runALatency ?? 0))}ms
            </div>
          </div>
          <div className={cn("rounded-xl border p-4", metricTone(tokenTrend))}>
            <div className="text-xs uppercase tracking-[0.18em] text-gray-300">Token Usage</div>
            <div className="mt-2 text-sm text-gray-300">
              {tokensA.toLocaleString()} → {tokensB.toLocaleString()}
            </div>
            <div className="mt-2 text-xs text-gray-400">Delta {formatDelta(comparison.summary.token_delta)}</div>
          </div>
          <div className={cn("rounded-xl border p-4", metricTone(comparison.summary.cost_delta <= 0 ? "improved" : "regressed"))}>
            <div className="text-xs uppercase tracking-[0.18em] text-gray-300">Estimated Cost</div>
            <div className="mt-2 text-sm text-gray-300">
              ${comparison.diffs.metrics.run_a.estimated_cost.toFixed(6)} → ${comparison.diffs.metrics.run_b.estimated_cost.toFixed(6)}
            </div>
            <div className="mt-2 text-xs text-gray-400">Delta ${formatDelta(comparison.summary.cost_delta, 6)}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-white/10 bg-[#101722] shadow-none">
        <CardHeader>
          <CardTitle className="text-gray-100">Runs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Link href={`/runs/${comparison.run_a.id}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04]">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Run A</div>
            <div className="mt-2 font-medium text-gray-100">{comparison.run_a.workflow_name}</div>
            <div className="text-sm text-gray-400">{comparison.run_a.id}</div>
            <div className="mt-2 text-xs text-gray-500">{comparison.run_a.status}{versionA ? ` · ${versionA}` : ""}</div>
          </Link>
          <Link href={`/runs/${comparison.run_b.id}`} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:bg-white/[0.04]">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Run B</div>
            <div className="mt-2 font-medium text-gray-100">{comparison.run_b.workflow_name}</div>
            <div className="text-sm text-gray-400">{comparison.run_b.id}</div>
            <div className="mt-2 text-xs text-gray-500">{comparison.run_b.status}{versionB ? ` · ${versionB}` : ""}</div>
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border border-white/10 bg-[#101722] shadow-none">
          <CardHeader>
            <CardTitle className="text-gray-100">Prompt Diffs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.diffs.prompts.map((diff) => (
              <DiffBlock key={diff.label} title={diff.label} left={diff.run_a} right={diff.run_b} />
            ))}
          </CardContent>
        </Card>

        <Card className="border border-white/10 bg-[#101722] shadow-none">
          <CardHeader>
            <CardTitle className="text-gray-100">Output Diffs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.diffs.responses.map((diff) => (
              <DiffBlock key={diff.label} title={diff.label} left={diff.run_a} right={diff.run_b} />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border border-white/10 bg-[#101722] shadow-none">
          <CardHeader>
            <CardTitle className="text-gray-100">Span List Diff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-300">
            {comparison.diffs.spans.length === 0
              ? "No span list changes."
              : comparison.diffs.spans.map((span) => (
                  <div key={span} className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    {span}
                  </div>
                ))}
          </CardContent>
        </Card>

        <Card className="border border-white/10 bg-[#101722] shadow-none">
          <CardHeader>
            <CardTitle className="text-gray-100">Models & Artifact Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-gray-400">Models</div>
              <div className="flex flex-wrap gap-2">
                {comparison.diffs.models.map((model) => (
                  <span key={model} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-200">
                    {model}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {comparison.diffs.artifacts.map((diff) => (
                <DiffBlock key={diff.label} title={diff.label} left={diff.run_a} right={diff.run_b} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
