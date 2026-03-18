"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";

import { type Run } from "@/lib/api";
import { parseRunVersion } from "@/lib/run-version";
import { cn } from "@/lib/utils";

type RunCompareSelectorProps = {
  runs: Run[];
};

type RunWithVersion = Run & { version: string | null };

function formatRunLabel(run: RunWithVersion) {
  const started = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(run.started_at));
  return `${run.workflow_name} · ${run.status} · ${started}`;
}

export function RunCompareSelector({ runs }: RunCompareSelectorProps) {
  const router = useRouter();
  const preparedRuns = useMemo<RunWithVersion[]>(
    () => runs.map((run) => ({ ...run, version: parseRunVersion(run) })),
    [runs],
  );

  const allVersions = useMemo(
    () => Array.from(new Set(preparedRuns.map((run) => run.version).filter((version): version is string => Boolean(version)))).sort(),
    [preparedRuns],
  );

  const [search, setSearch] = useState("");
  const [versionA, setVersionA] = useState("all");
  const [versionB, setVersionB] = useState("all");

  const initialA = preparedRuns[0]?.id ?? "";
  const initialB = preparedRuns[1]?.id ?? preparedRuns[0]?.id ?? "";
  const [runAId, setRunAId] = useState(initialA);
  const [runBId, setRunBId] = useState(initialB);

  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase();
    return preparedRuns.filter((run) => {
      if (!query) return true;
      return (
        run.id.toLowerCase().includes(query) ||
        run.workflow_name.toLowerCase().includes(query) ||
        run.agent_name.toLowerCase().includes(query) ||
        (run.version ?? "").toLowerCase().includes(query)
      );
    });
  }, [preparedRuns, search]);

  const runsForA = filteredRuns.filter((run) => versionA === "all" || run.version === versionA);
  const runsForB = filteredRuns.filter((run) => versionB === "all" || run.version === versionB);

  const selectedA = preparedRuns.find((run) => run.id === runAId) ?? null;
  const selectedB = preparedRuns.find((run) => run.id === runBId) ?? null;
  const canCompare = Boolean(runAId && runBId && runAId !== runBId);

  function startComparison() {
    if (!canCompare) return;
    router.push(`/runs/compare/${runAId}/${runBId}`);
  }

  return (
    <section className="space-y-6 p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Compare Runs</h1>
          <p className="mt-1 text-sm text-gray-400">Select any two runs, including version pairs like v1 vs v2.</p>
        </div>
        <Link href="/runs" className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-gray-300 hover:bg-white/[0.04]">
          Back to runs
        </Link>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#101722] p-4">
        <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-gray-400">Search</label>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find by run id, workflow, agent, or version"
          className="h-10 w-full rounded-lg border border-white/15 bg-[#0C131D] px-3 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:border-blue-400/50"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#101722] p-4">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-400">Run A</div>
          <div className="space-y-3">
            <select
              value={versionA}
              onChange={(event) => setVersionA(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/15 bg-[#0C131D] px-3 text-sm text-gray-100"
            >
              <option value="all">All versions</option>
              {allVersions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
            <select
              value={runAId}
              onChange={(event) => setRunAId(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/15 bg-[#0C131D] px-3 text-sm text-gray-100"
            >
              {runsForA.map((run) => (
                <option key={run.id} value={run.id}>
                  {formatRunLabel(run)}
                </option>
              ))}
            </select>
            {selectedA ? <RunPreview run={selectedA} /> : null}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#101722] p-4">
          <div className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-400">Run B</div>
          <div className="space-y-3">
            <select
              value={versionB}
              onChange={(event) => setVersionB(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/15 bg-[#0C131D] px-3 text-sm text-gray-100"
            >
              <option value="all">All versions</option>
              {allVersions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
            <select
              value={runBId}
              onChange={(event) => setRunBId(event.target.value)}
              className="h-10 w-full rounded-lg border border-white/15 bg-[#0C131D] px-3 text-sm text-gray-100"
            >
              {runsForB.map((run) => (
                <option key={run.id} value={run.id}>
                  {formatRunLabel(run)}
                </option>
              ))}
            </select>
            {selectedB ? <RunPreview run={selectedB} /> : null}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#101722] p-4">
        <div className="text-sm text-gray-400">
          {canCompare ? "Ready to compare selected runs." : "Choose two different runs to continue."}
        </div>
        <button
          type="button"
          disabled={!canCompare}
          onClick={startComparison}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
            canCompare ? "bg-blue-500 text-white hover:bg-blue-400" : "bg-white/10 text-gray-500",
          )}
        >
          <ArrowRightLeft className="size-4" />
          Compare runs
        </button>
      </div>
    </section>
  );
}

function RunPreview({ run }: { run: RunWithVersion }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#0C131D] px-3 py-2.5 text-xs text-gray-300">
      <div className="truncate font-medium text-gray-100">{run.workflow_name}</div>
      <div className="mt-1 truncate text-gray-400">{run.id}</div>
      <div className="mt-1 text-gray-500">{run.status}{run.version ? ` · ${run.version}` : ""}</div>
    </div>
  );
}
