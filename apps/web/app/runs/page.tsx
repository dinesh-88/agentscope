import { AppShell } from "@/components/app-shell";
import { RunsScreen } from "@/components/runs-screen";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const runs = await getRuns();

  return (
    <AppShell activePath="/runs">
      <RunsScreen runs={runs} />
    </AppShell>
  );
}
