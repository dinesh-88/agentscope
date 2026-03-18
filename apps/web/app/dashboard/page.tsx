import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard-view";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const runs = await getRuns();

  return (
    <AppShell activePath="/dashboard" theme="dark" mainClassName="px-0 pb-0">
      <DashboardView runs={runs} dark />
    </AppShell>
  );
}
