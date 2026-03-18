import { AppShell } from "@/components/app-shell";
import { RunCompareSelector } from "@/components/run-compare-selector";
import { getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function RunCompareSelectionPage() {
  const runs = await getRuns();

  return (
    <AppShell activePath="/runs" theme="dark">
      <RunCompareSelector runs={runs} />
    </AppShell>
  );
}
