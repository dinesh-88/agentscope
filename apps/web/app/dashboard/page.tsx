import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard-view";
import { getRuns, getRunSpans } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const runs = await getRuns();
  const recentRuns = [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 15);
  const spansByRun = Object.fromEntries(
    await Promise.all(
      recentRuns.map(async (run) => {
        const spans = await getRunSpans(run.id);
        return [run.id, spans] as const;
      }),
    ),
  );

  return (
    <AppShell activePath="/dashboard" theme="dark" mainClassName="px-0 pb-0">
      <DashboardView runs={runs} spansByRun={spansByRun} />
    </AppShell>
  );
}
