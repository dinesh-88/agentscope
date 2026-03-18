import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard-view";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const runs = await getRuns();

  return (
    <AppShell activePath="/dashboard">
      <DashboardView runs={runs} />
    </AppShell>
  );
}
