"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle, Info, Link as LinkIcon } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { mockIssues } from "@/figma/src/app/data/mockData";
import { type IssueSeverity } from "@/figma/src/app/types";

function getSeverityIcon(severity: IssueSeverity) {
  switch (severity) {
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

function getSeverityColor(severity: IssueSeverity) {
  switch (severity) {
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

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function InsightsPage() {
  const issuesBySeverity = {
    critical: mockIssues.filter((item) => item.severity === "critical").length,
    warning: mockIssues.filter((item) => item.severity === "warning").length,
    info: mockIssues.filter((item) => item.severity === "info").length,
  };

  return (
    <AppShell activePath="/insights">
      <div className="p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">Insights</h1>
          <p className="text-gray-600">Review detected issues and recommendations</p>
        </div>

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
          <h2 className="mb-4 text-base font-medium text-gray-900">Detected Issues ({mockIssues.length})</h2>
          <div className="space-y-4">
            {mockIssues.map((issue) => {
              const Icon = getSeverityIcon(issue.severity);
              return (
                <div key={issue.id} className={`rounded-lg border p-4 ${getSeverityColor(issue.severity)}`}>
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-semibold text-gray-900">{issue.message}</h4>
                          <p className="mt-1 text-sm text-gray-600">{getIssueTypeLabel(issue.type)}</p>
                        </div>
                        <span className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium capitalize ${getSeverityColor(issue.severity)}`}>
                          {issue.severity}
                        </span>
                      </div>

                      <p className="mb-3 text-sm text-gray-700">{issue.details}</p>

                      <div className="mb-3 rounded bg-white/50 p-3">
                        <p className="mb-1 text-sm font-medium text-gray-900">Suggestion</p>
                        <p className="text-sm text-gray-700">{issue.suggestion}</p>
                      </div>

                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>{formatDate(issue.timestamp)}</span>
                        {issue.runId ? (
                          <Link href={`/runs/${issue.runId}`} className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-800">
                            <LinkIcon className="h-3 w-3" />
                            View Run
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
