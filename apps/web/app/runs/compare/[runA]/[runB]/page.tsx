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
    <AppShell activePath="/runs" theme="dark">
      <section className="space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <Link href="/runs/compare" className="text-sm font-medium text-blue-300 hover:text-blue-200">
            Change selected runs
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-gray-100">Run Compare</h1>
        </div>
        <RunCompareView comparison={comparison} />
      </section>
    </AppShell>
  );
}
