"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { type DemoScenario, runDemoScenario } from "@/lib/api";

type DemoScenariosProps = {
  scenarios: DemoScenario[];
};

export function DemoScenarios({ scenarios }: DemoScenariosProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [completedRunId, setCompletedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runScenario(id: string) {
    setPendingId(id);
    setError(null);

    try {
      const response = await runDemoScenario(id);
      setCompletedRunId(response.run_id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to start demo scenario.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {scenarios.map((scenario) => (
        <div key={scenario.id} className="rounded-3xl border border-black/8 bg-white p-6 shadow-none">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-lg font-semibold text-neutral-950">{scenario.name}</div>
              <div className="mt-1 text-sm text-neutral-500">{scenario.id}</div>
            </div>
            <Button disabled={pendingId === scenario.id} onClick={() => runScenario(scenario.id)} type="button">
              {pendingId === scenario.id ? "Replaying..." : "Run demo"}
            </Button>
          </div>
        </div>
      ))}

      {completedRunId ? (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-sm text-emerald-950">
          Demo run created. <Link className="font-medium underline" href={`/runs/${completedRunId}`}>Open run detail</Link>
        </div>
      ) : null}

      {error ? <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
