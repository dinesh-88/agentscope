import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { getCurrentUser, getProjectInsights } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type Severity = "critical" | "warning" | "info";

function getSeverityIcon(severity: string) {
  switch (severity as Severity) {
    case "critical":
      return AlertCircle;
    case "warning":
      return AlertTriangle;
    case "info":
      return Info;
    default:
      return Info;
  }
}

function getSeverityColor(severity: string) {
  switch (severity as Severity) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "warning":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "info":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getIssueTypeLabel(type: string) {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function InsightsPage() {
  const me = await getCurrentUser();
  const defaultProjectId = me?.onboarding.default_project_id ?? null;
  const insights = defaultProjectId ? await getProjectInsights(defaultProjectId) : [];

  const issuesBySeverity = {
    critical: insights.filter((item) => item.severity === "critical").length,
    warning: insights.filter((item) => item.severity === "warning").length,
    info: insights.filter((item) => item.severity === "info").length,
  };

  return (
    <AppShell activePath="/insights">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Insights</h1>
          <p className="text-gray-600">Review production issues and recommendations</p>
        </div>

        {!defaultProjectId ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
            No default project found for this account.
          </div>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-red-50 p-3">
                    <AlertCircle className="h-6 w-6 text-red-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Critical</p>
                    <p className="text-2xl font-semibold text-gray-900">{issuesBySeverity.critical}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-yellow-50 p-3">
                    <AlertTriangle className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Warnings</p>
                    <p className="text-2xl font-semibold text-gray-900">{issuesBySeverity.warning}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-50 p-3">
                    <Info className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Info</p>
                    <p className="text-2xl font-semibold text-gray-900">{issuesBySeverity.info}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-base font-medium text-gray-900">Detected Issues ({insights.length})</h2>

              {insights.length === 0 ? (
                <p className="text-sm text-gray-600">No issues detected for this project.</p>
              ) : (
                <div className="space-y-4">
                  {insights.map((issue) => {
                    const Icon = getSeverityIcon(issue.severity);
                    return (
                      <div key={issue.id} className={`rounded-lg border p-4 ${getSeverityColor(issue.severity)}`}>
                        <div className="flex items-start gap-3">
                          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex items-start justify-between gap-4">
                              <div>
                                <h4 className="font-semibold text-gray-900">{issue.message}</h4>
                                <p className="mt-1 text-sm text-gray-600">{getIssueTypeLabel(issue.insight_type)}</p>
                              </div>
                              <span className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium capitalize ${getSeverityColor(issue.severity)}`}>
                                {issue.severity}
                              </span>
                            </div>

                            <div className="mb-3 rounded bg-white/50 p-3">
                              <p className="mb-1 text-sm font-medium text-gray-900">Recommendation</p>
                              <p className="text-sm text-gray-700">{issue.recommendation}</p>
                            </div>

                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <span>{formatDate(issue.created_at)}</span>
                              <span>Runs analyzed: {issue.run_count}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
