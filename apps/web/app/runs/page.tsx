import { AppShell } from "@/components/app-shell";
import { RunsScreen } from "@/components/runs-screen";
import { getRunsFiltered } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type RunsPageProps = {
  searchParams?: Promise<{
    query?: string;
    status?: string;
    model?: string;
    agent?: string;
    workflow_name?: string;
    agent_name?: string;
    tokens_min?: string;
    tokens_max?: string;
    duration_min_ms?: string;
    duration_max_ms?: string;
    time_from?: string;
    time_to?: string;
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
