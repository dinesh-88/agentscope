"use client";

import Link from "next/link";
import { AlertTriangle, Bell, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getCurrentUser, getProjectAlerts, type ProjectAlertEvent } from "@/lib/api";

type AlertsTopbarProps = {
  theme?: "light" | "dark";
};

function severityRank(severity: string) {
  const normalized = severity.toLowerCase();
  if (normalized === "critical") return 4;
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  return 1;
}

export function AlertsTopbar({ theme = "dark" }: AlertsTopbarProps) {
  const [alerts, setAlerts] = useState<ProjectAlertEvent[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const me = await getCurrentUser();
      const projectId = me.onboarding.default_project_id;
      if (!projectId) {
        if (!cancelled) setAlerts([]);
        return;
      }

      const nextAlerts = await getProjectAlerts(projectId);
      if (!cancelled) {
        setAlerts(nextAlerts);
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const sortedAlerts = useMemo(
    () =>
      [...alerts].sort((left, right) => {
        return severityRank(right.severity) - severityRank(left.severity);
      }),
    [alerts],
  );

  const criticalCount = sortedAlerts.filter((alert) => severityRank(alert.severity) >= 3).length;

  return (
    <div
      className={`sticky top-0 z-10 border-b px-4 py-3 backdrop-blur sm:px-6 ${
        theme === "dark" ? "border-white/10 bg-[#0F141B]/90" : "border-gray-200 bg-white/95"
      }`}
    >
      <div className="flex items-center justify-end">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${
              theme === "dark"
                ? "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Bell className="h-4 w-4" />
            <span>Alerts</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                criticalCount > 0 ? "bg-red-500/20 text-red-200" : "bg-slate-500/20 text-slate-300"
              }`}
            >
              {criticalCount}
            </span>
          </button>

          {open ? (
            <div
              className={`absolute right-0 mt-2 w-96 max-w-[92vw] rounded-lg border p-3 shadow-2xl ${
                theme === "dark" ? "border-slate-800 bg-[#101720]" : "border-gray-200 bg-white"
              }`}
            >
              <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${theme === "dark" ? "text-slate-400" : "text-gray-500"}`}>
                Recent alerts
              </p>
              <div className="max-h-80 space-y-2 overflow-auto">
                {sortedAlerts.map((alert) => {
                  return (
                    <div
                      key={alert.id}
                      className={`rounded-md border p-3 ${
                        theme === "dark" ? "border-slate-800 bg-slate-950/60" : "border-gray-200 bg-gray-50"
                      }`}
                    >
                      <div className="mb-1 flex items-start justify-between gap-3">
                        <p className={`text-sm ${theme === "dark" ? "text-slate-100" : "text-gray-900"}`}>{alert.message}</p>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                            severityRank(alert.severity) >= 3
                              ? "bg-red-500/20 text-red-200"
                              : "bg-amber-500/20 text-amber-200"
                          }`}
                        >
                          {alert.severity}
                        </span>
                      </div>
                      <p className={`text-[11px] ${theme === "dark" ? "text-slate-400" : "text-gray-500"}`}>{alert.alert_type}</p>
                      {alert.issue_key ? (
                        <div className="mt-2 space-y-1">
                          <Link
                            href={`/dashboard?issue_key=${encodeURIComponent(alert.issue_key)}`}
                            className={`inline-flex items-center gap-1 text-xs ${
                              theme === "dark" ? "text-blue-300 hover:text-blue-200" : "text-blue-600 hover:text-blue-500"
                            }`}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            <span className="font-mono">{alert.issue_key}</span>
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {sortedAlerts.length === 0 ? (
                  <p className={`text-xs ${theme === "dark" ? "text-slate-400" : "text-gray-500"}`}>No active issues detected.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
