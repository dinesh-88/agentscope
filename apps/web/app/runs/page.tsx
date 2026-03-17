import { AppShell } from "@/components/app-shell";
import { RunsScreen } from "@/components/runs-screen";
import { getRunsFiltered } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type RunsPageProps = {
  searchParams?: Promise<{
    query?: string;
    status?: string;
    workflow_name?: string;
    agent_name?: string;
  }>;
};

export default async function RunsPage({ searchParams }: RunsPageProps) {
  const filters = (await searchParams) ?? {};
  const runs = await getRunsFiltered(filters);

  return (
    <AppShell activePath="/runs">
      <RunsScreen initialFilters={filters} runs={runs} />
    </AppShell>
  );
}
