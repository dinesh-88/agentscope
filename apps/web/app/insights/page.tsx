import Link from "next/link";
import { AlertCircle, AlertTriangle, Info, Link2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type IssueSeverity = "critical" | "warning" | "info";

type InsightIssue = {
  id: string;
  runId: string;
  type: string;
  severity: IssueSeverity;
  message: string;
  details: string;
  suggestion: string;
  timestamp: string;
};

const issues: InsightIssue[] = [
  {
    id: "issue_001",
    runId: "run_003",
    type: "prompt_too_large",
    severity: "warning",
    message: "Prompt exceeds recommended size",
    details:
      "The prompt consumed most of the available context window. This increases cost and raises the chance of truncation.",
    suggestion: "Compress retrieved context or add a summarization pass before the main model call.",
    timestamp: "2026-03-10T07:45:24",
  },
  {
    id: "issue_002",
    runId: "run_003",
    type: "schema_error",
    severity: "critical",
    message: "Output schema validation failed",
    details:
      "The workflow expected structured JSON output but received malformed content from the model response.",
    suggestion: "Tighten schema instructions and enable structured output mode where the provider supports it.",
    timestamp: "2026-03-10T07:45:25",
  },
  {
    id: "issue_003",
    runId: "run_008",
    type: "tool_failure",
    severity: "critical",
    message: "Database query timeout",
    details:
      "The retrieval tool timed out while querying the knowledge base, causing the run to fail before response generation.",
    suggestion: "Add retry logic with exponential backoff and review timeout settings for large datasets.",
    timestamp: "2026-03-09T20:34:23",
  },
  {
    id: "issue_004",
    runId: "run_002",
    type: "high_latency",
    severity: "warning",
    message: "LLM response time exceeded threshold",
    details:
      "A model call completed significantly above the expected P95 latency for this workflow profile.",
    suggestion: "Use a faster model for this stage or parallelize the prerequisite calls where possible.",
    timestamp: "2026-03-10T09:15:54",
  },
  {
    id: "issue_005",
    runId: "run_004",
    type: "token_limit",
    severity: "info",
    message: "High token usage detected",
    details:
      "This run used substantially more tokens than similar successful runs in the same workflow family.",
    suggestion: "Review prompt efficiency and cache any stable intermediate results to reduce repeated token spend.",
    timestamp: "2026-03-10T06:12:45",
  },
];

function getSeverityIcon(severity: IssueSeverity) {
  switch (severity) {
    case "critical":
      return AlertCircle;
    case "warning":
      return AlertTriangle;
    default:
      return Info;
  }
}

function getSeverityColor(severity: IssueSeverity) {
  switch (severity) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-200";
    case "warning":
      return "bg-yellow-100 text-yellow-800 border-yellow-200";
    default:
      return "bg-blue-100 text-blue-800 border-blue-200";
  }
}

function getSummaryTone(severity: IssueSeverity) {
  switch (severity) {
    case "critical":
      return "bg-red-50 text-red-600";
    case "warning":
      return "bg-yellow-50 text-yellow-600";
    default:
      return "bg-blue-50 text-blue-600";
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

export default function InsightsPage() {
  const summary = {
    critical: issues.filter((issue) => issue.severity === "critical").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
  };

  return (
    <AppShell activePath="/insights">
      <section className="p-6 sm:p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-gray-900">Insights</h1>
          <p className="text-gray-600">Review detected issues and recommendations.</p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Card className="border border-black/8 shadow-none ring-0">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-3 ${getSummaryTone("critical")}`}>
                  <AlertCircle className="size-6" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Critical</p>
                  <p className="text-2xl font-semibold text-gray-900">{summary.critical}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-black/8 shadow-none ring-0">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-3 ${getSummaryTone("warning")}`}>
                  <AlertTriangle className="size-6" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Warnings</p>
                  <p className="text-2xl font-semibold text-gray-900">{summary.warning}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-black/8 shadow-none ring-0">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`rounded-lg p-3 ${getSummaryTone("info")}`}>
                  <Info className="size-6" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Info</p>
                  <p className="text-2xl font-semibold text-gray-900">{summary.info}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border border-black/8 shadow-none ring-0">
          <CardHeader>
            <CardTitle>Detected Issues ({issues.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {issues.map((issue) => {
                const Icon = getSeverityIcon(issue.severity);
                return (
                  <div key={issue.id} className={`rounded-lg border p-4 ${getSeverityColor(issue.severity)}`}>
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 size-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h4 className="font-semibold text-gray-900">{issue.message}</h4>
                            <p className="mt-1 text-sm text-gray-600">{getIssueTypeLabel(issue.type)}</p>
                          </div>
                          <span className={`inline-flex rounded px-2 py-1 text-xs font-medium capitalize ${getSeverityColor(issue.severity)}`}>
                            {issue.severity}
                          </span>
                        </div>

                        <p className="mb-3 text-sm text-gray-700">{issue.details}</p>

                        <div className="mb-3 rounded bg-white/60 p-3">
                          <p className="mb-1 text-sm font-medium text-gray-900">Suggestion</p>
                          <p className="text-sm text-gray-700">{issue.suggestion}</p>
                        </div>

                        <div className="flex flex-col gap-2 text-sm text-gray-600 md:flex-row md:items-center md:gap-4">
                          <span>{formatDate(issue.timestamp)}</span>
                          <Link href={`/runs/${issue.runId}`} className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-800">
                            <Link2 className="size-3" />
                            View Run
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
