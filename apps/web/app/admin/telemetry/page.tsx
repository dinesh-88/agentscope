import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { getAdminTelemetry, getCurrentUser } from "@/lib/server-api";

export const dynamic = "force-dynamic";

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default async function AdminTelemetryPage() {
  const me = await getCurrentUser();
  if (!me) {
    redirect("/login");
  }
  if (!me.user.is_super_admin) {
    redirect("/dashboard");
  }

  const telemetry = await getAdminTelemetry();

  return (
    <AppShell activePath="/admin/telemetry">
      <section className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-neutral-950 dark:text-neutral-100">Telemetry Admin</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">Internal usage telemetry dashboard (super admin only).</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Overview</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Active Projects</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.active_projects.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Events Today</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.events_today.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Events Last 7 Days</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.events_last_7_days.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Error Rate</p>
              <p className="mt-1 text-2xl font-semibold">{percent(telemetry.error_rate)}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Ingest Pipeline Overview</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Runs Today</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.ingest_overview.runs_today.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Runs Last 7 Days</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.ingest_overview.runs_last_7_days.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Spans Last 7 Days</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.ingest_overview.spans_last_7_days.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
              <p className="text-xs text-neutral-500">Artifacts Last 7 Days</p>
              <p className="mt-1 text-2xl font-semibold">{telemetry.ingest_overview.artifacts_last_7_days.toLocaleString()}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">SDK Usage</h2>
          <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
            <ul className="space-y-2 text-sm">
              {telemetry.sdk_usage.map((item) => (
                <li key={item.sdk} className="flex items-center justify-between">
                  <span className="font-medium">{item.sdk}</span>
                  <span>{item.events.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Version Distribution</h2>
          <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10">
                    <th className="py-2 pr-3 font-medium">Version</th>
                    <th className="py-2 font-medium">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.version_adoption.map((item) => (
                    <tr key={item.sdk_version} className="border-b border-black/5 dark:border-white/5">
                      <td className="py-2 pr-3">{item.sdk_version}</td>
                      <td className="py-2">{item.events.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Source Breakdown</h2>
          <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10">
                    <th className="py-2 pr-3 font-medium">Source</th>
                    <th className="py-2 pr-3 font-medium">SDK Events</th>
                    <th className="py-2 pr-3 font-medium">Ingested Runs</th>
                    <th className="py-2 font-medium">Failed Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.source_breakdown.map((item) => (
                    <tr key={item.source} className="border-b border-black/5 dark:border-white/5">
                      <td className="py-2 pr-3">{item.source}</td>
                      <td className="py-2 pr-3">{item.sdk_events.toLocaleString()}</td>
                      <td className="py-2 pr-3">{item.ingested_runs.toLocaleString()}</td>
                      <td className="py-2">{item.failed_runs.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Events Timeline (Daily)</h2>
          <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10">
                    <th className="py-2 pr-3 font-medium">Day</th>
                    <th className="py-2 pr-3 font-medium">Events</th>
                    <th className="py-2 pr-3 font-medium">Daily Active Projects</th>
                    <th className="py-2 font-medium">Error Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.events_per_day.map((eventPoint, index) => (
                    <tr key={`${eventPoint.day}-${index}`} className="border-b border-black/5 dark:border-white/5">
                      <td className="py-2 pr-3">{eventPoint.day}</td>
                      <td className="py-2 pr-3">{eventPoint.events.toLocaleString()}</td>
                      <td className="py-2 pr-3">{telemetry.daily_active_projects[index]?.active_projects ?? 0}</td>
                      <td className="py-2">{percent(eventPoint.error_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Pipeline Daily (SDK vs Ingest vs Proxy)</h2>
          <div className="rounded-lg border border-black/10 bg-white/90 p-4 dark:border-white/10 dark:bg-white/5">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-black/10 dark:border-white/10">
                    <th className="py-2 pr-3 font-medium">Day</th>
                    <th className="py-2 pr-3 font-medium">SDK Events</th>
                    <th className="py-2 pr-3 font-medium">Ingested Runs</th>
                    <th className="py-2 pr-3 font-medium">Proxy Runs</th>
                    <th className="py-2 font-medium">Proxy Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {telemetry.pipeline_daily.map((point, index) => (
                    <tr key={`${point.day}-${index}`} className="border-b border-black/5 dark:border-white/5">
                      <td className="py-2 pr-3">{point.day}</td>
                      <td className="py-2 pr-3">{point.sdk_events.toLocaleString()}</td>
                      <td className="py-2 pr-3">{point.ingested_runs.toLocaleString()}</td>
                      <td className="py-2 pr-3">{point.proxy_runs.toLocaleString()}</td>
                      <td className="py-2">{point.proxy_errors.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
