import { AlertTriangle, Gauge, Lightbulb, ShieldAlert, Sparkles } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getProjectFailureClusters, getProjectInsights } from "@/lib/server-api";
import { type FailureCluster, type ProjectInsight } from "@/lib/api";

export const dynamic = "force-dynamic";

function categoryTitle(category: string) {
  switch (category) {
    case "failure_patterns":
      return "Failure Patterns";
    case "cost_optimization":
      return "Cost Optimization";
    case "performance_bottlenecks":
      return "Performance Bottlenecks";
    case "prompt_issues":
      return "Prompt Issues";
    default:
      return "Other";
  }
}

function categoryIcon(category: string) {
  switch (category) {
    case "failure_patterns":
      return ShieldAlert;
    case "cost_optimization":
      return Lightbulb;
    case "performance_bottlenecks":
      return Gauge;
    case "prompt_issues":
      return Sparkles;
    default:
      return AlertTriangle;
  }
}

function impactBadgeClasses(impact: ProjectInsight["impact"]) {
  if (impact === "high") return "border-red-400/40 bg-red-500/10 text-red-200";
  if (impact === "medium") return "border-amber-400/40 bg-amber-500/10 text-amber-200";
  return "border-cyan-400/40 bg-cyan-500/10 text-cyan-200";
}

function confidenceLabel(confidence: number) {
  return `${Math.round(confidence * 100)}% confidence`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortRunId(runId: string) {
  return runId.slice(0, 8);
}

export default async function InsightsPage() {
  const me = await getCurrentUser();
  const defaultProjectId = me?.onboarding.default_project_id ?? null;
  const [insights, clusters] = defaultProjectId
    ? await Promise.all([
        getProjectInsights(defaultProjectId),
        getProjectFailureClusters(defaultProjectId),
      ])
    : [[], [] as FailureCluster[]];

  const issuesByImpact = {
    high: insights.filter((item) => item.impact === "high").length,
    medium: insights.filter((item) => item.impact === "medium").length,
    low: insights.filter((item) => item.impact === "low").length,
  };
  const groupedInsights = new Map<string, ProjectInsight[]>();
  for (const insight of insights) {
    const existing = groupedInsights.get(insight.category) ?? [];
    existing.push(insight);
    groupedInsights.set(insight.category, existing);
  }

  return (
    <AppShell activePath="/insights">
      <div className="space-y-8 p-8">
        <div>
          <h1 className="mb-2 text-3xl font-semibold text-white">Insights Engine</h1>
          <p className="text-sm text-slate-400">
            Actionable recommendations generated from runs, spans, and root-cause analysis.
          </p>
        </div>

        {!defaultProjectId ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-300">
            No default project found for this account.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-red-900/70 bg-red-950/40 p-5">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-300" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-red-200">High Impact</p>
                    <p className="text-2xl font-semibold text-white">{issuesByImpact.high}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-amber-900/70 bg-amber-950/30 p-5">
                <div className="flex items-center gap-3">
                  <Gauge className="h-5 w-5 text-amber-300" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-amber-200">Medium Impact</p>
                    <p className="text-2xl font-semibold text-white">{issuesByImpact.medium}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-cyan-900/70 bg-cyan-950/30 p-5">
                <div className="flex items-center gap-3">
                  <Lightbulb className="h-5 w-5 text-cyan-300" />
                  <div>
                    <p className="text-xs uppercase tracking-wide text-cyan-200">Low Impact</p>
                    <p className="text-2xl font-semibold text-white">{issuesByImpact.low}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6">
              <h2 className="mb-4 text-base font-medium text-white">Detected Insights ({insights.length})</h2>

              {insights.length === 0 ? (
                <p className="text-sm text-slate-400">No insights detected for this project.</p>
              ) : (
                <div className="space-y-6">
                  {Array.from(groupedInsights.entries()).map(([category, categoryInsights]) => {
                    const Icon = categoryIcon(category);
                    return (
                      <div key={category}>
                        <div className="mb-3 flex items-center gap-2">
                          <Icon className="h-4 w-4 text-slate-300" />
                          <h3 className="text-sm font-medium uppercase tracking-wide text-slate-300">
                            {categoryTitle(category)}
                          </h3>
                        </div>
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                          {categoryInsights.map((insight) => (
                            <div
                              key={insight.id}
                              className={`rounded-xl border bg-slate-900/70 p-4 ${
                                insight.highlighted
                                  ? "border-red-500/40 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]"
                                  : "border-slate-800"
                              }`}
                            >
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <h4 className="text-sm font-semibold text-white">{insight.title}</h4>
                                <span
                                  className={`rounded-md border px-2 py-1 text-xs font-medium capitalize ${impactBadgeClasses(insight.impact)}`}
                                >
                                  {insight.impact}
                                </span>
                              </div>
                              <p className="text-sm text-slate-300">{insight.description}</p>
                              <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/70 p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                                  Suggestion
                                </p>
                                <p className="mt-1 text-sm text-slate-200">{insight.suggestion}</p>
                              </div>
                              <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                                <span>{confidenceLabel(insight.confidence)}</span>
                                <span>{formatDate(insight.created_at)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-6">
              <h2 className="mb-4 text-base font-medium text-white">
                Failure Clusters ({clusters.length})
              </h2>
              {clusters.length === 0 ? (
                <p className="text-sm text-slate-400">No recurring failure clusters detected.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {clusters.map((cluster) => (
                    <div key={cluster.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-white">{cluster.cluster_key}</h3>
                        <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200">
                          {cluster.count} occurrences
                        </span>
                      </div>
                      <p className="text-xs uppercase tracking-wide text-slate-400">
                        Error Type: {cluster.error_type}
                      </p>
                      {cluster.common_span ? (
                        <p className="mt-2 text-xs text-slate-300">
                          Common Span: <span className="font-medium text-slate-100">{cluster.common_span}</span>
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {cluster.sample_run_ids.map((runId) => (
                          <a
                            key={runId}
                            href={`/runs/${runId}`}
                            className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs font-mono text-blue-300 hover:text-blue-200"
                          >
                            {shortRunId(runId)}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
