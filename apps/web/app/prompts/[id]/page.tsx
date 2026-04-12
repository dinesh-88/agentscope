import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { comparePromptVersions, getPrompt, getPromptVersions } from "@/lib/server-api";

type PromptDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PromptDetailPage({ params }: PromptDetailPageProps) {
  const { id } = await params;
  const detail = await getPrompt(id);
  if (!detail) notFound();
  const versions = await getPromptVersions(id);
  const newest = versions[0];
  const prev = versions[1];
  const diff = newest && prev ? await comparePromptVersions(id, prev.version, newest.version) : null;

  const metricsByVersion = new Map(detail.metrics.map((metric) => [metric.prompt_version_id, metric]));

  return (
    <AppShell activePath="/prompts">
      <div className="space-y-6 p-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{detail.prompt.name}</h1>
          <p className="text-gray-600">Prompt ID: {detail.prompt.id}</p>
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-medium text-gray-900">Version history + metrics</h2>
          <div className="space-y-3">
            {versions.map((version) => {
              const metric = metricsByVersion.get(version.id);
              return (
                <div key={version.id} className="rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 text-sm font-medium text-gray-900">v{version.version} · {version.hash.slice(0, 12)}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-700 md:grid-cols-4">
                    <div>Failure rate: {(((metric?.failure_rate ?? 0) * 100)).toFixed(1)}%</div>
                    <div>Error rate: {(((metric?.error_rate ?? 0) * 100)).toFixed(1)}%</div>
                    <div>Avg latency: {(metric?.avg_latency_ms ?? 0).toFixed(0)}ms</div>
                    <div>Tokens: {metric?.total_tokens ?? 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-lg font-medium text-gray-900">Diff viewer (latest vs previous)</h2>
          {!diff ? (
            <p className="text-sm text-gray-600">Need at least 2 versions to show a diff.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <p className="text-gray-700">Comparing v{diff.from_version} → v{diff.to_version}</p>
              <div>
                <div className="font-medium text-green-700">Added</div>
                <pre className="overflow-auto rounded bg-green-50 p-3 text-xs">{diff.added_lines.join("\n") || "-"}</pre>
              </div>
              <div>
                <div className="font-medium text-red-700">Removed</div>
                <pre className="overflow-auto rounded bg-red-50 p-3 text-xs">{diff.removed_lines.join("\n") || "-"}</pre>
              </div>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
