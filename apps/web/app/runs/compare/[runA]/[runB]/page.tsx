import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { RunCompareView } from "@/components/run-compare-view";
import { compareRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type RunComparePageProps = {
  params: Promise<{ runA: string; runB: string }>;
};

export default async function RunComparePage({ params }: RunComparePageProps) {
  const { runA, runB } = await params;
  const comparison = await compareRuns(runA, runB);

  if (!comparison) {
    notFound();
  }

  return (
    <AppShell activePath="/runs">
      <section className="space-y-6 p-6 sm:p-8">
        <div>
          <Link href="/runs" className="text-sm font-medium text-blue-600 hover:text-blue-700">
            Back to runs
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-100">Run Compare</h1>
        </div>
        <RunCompareView comparison={comparison} />
      </section>
    </AppShell>
  );
}
