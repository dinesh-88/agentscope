import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type RunComparison } from "@/lib/api";

type RunCompareViewProps = {
  comparison: RunComparison;
};

function DiffBlock({
  title,
  left,
  right,
}: {
  title: string;
  left: string[];
  right: string[];
}) {
  return (
    <div className="rounded-xl border border-black/8">
      <div className="border-b border-black/8 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-900">{title}</div>
      <div className="grid gap-px bg-black/8 md:grid-cols-2">
        <pre className="min-h-32 bg-white p-4 text-xs leading-6 text-neutral-900">{left.join("\n\n") || "No data"}</pre>
        <pre className="min-h-32 bg-white p-4 text-xs leading-6 text-neutral-900">{right.join("\n\n") || "No data"}</pre>
      </div>
    </div>
  );
}

export function RunCompareView({ comparison }: RunCompareViewProps) {
  return (
    <div className="space-y-6">
      <Card className="border border-black/8 shadow-none">
        <CardHeader>
          <CardTitle>Comparison Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-black/8 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Status changed</div>
            <div className="mt-2 text-lg font-semibold text-neutral-950">
              {comparison.summary.status_changed ? "Yes" : "No"}
            </div>
          </div>
          <div className="rounded-xl border border-black/8 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Token delta</div>
            <div className="mt-2 text-lg font-semibold text-neutral-950">{comparison.summary.token_delta}</div>
          </div>
          <div className="rounded-xl border border-black/8 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Cost delta</div>
            <div className="mt-2 text-lg font-semibold text-neutral-950">
              ${comparison.summary.cost_delta.toFixed(6)}
            </div>
          </div>
          <div className="rounded-xl border border-black/8 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Span count delta</div>
            <div className="mt-2 text-lg font-semibold text-neutral-950">{comparison.summary.span_count_delta}</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-black/8 shadow-none">
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Link href={`/runs/${comparison.run_a.id}`} className="rounded-xl border border-black/8 p-4 hover:bg-neutral-50">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Run A</div>
            <div className="mt-2 font-medium text-neutral-950">{comparison.run_a.workflow_name}</div>
            <div className="text-sm text-neutral-600">{comparison.run_a.id}</div>
          </Link>
          <Link href={`/runs/${comparison.run_b.id}`} className="rounded-xl border border-black/8 p-4 hover:bg-neutral-50">
            <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">Run B</div>
            <div className="mt-2 font-medium text-neutral-950">{comparison.run_b.workflow_name}</div>
            <div className="text-sm text-neutral-600">{comparison.run_b.id}</div>
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border border-black/8 shadow-none">
          <CardHeader>
            <CardTitle>Prompt Diffs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.diffs.prompts.map((diff) => (
              <DiffBlock key={diff.label} title={diff.label} left={diff.run_a} right={diff.run_b} />
            ))}
          </CardContent>
        </Card>

        <Card className="border border-black/8 shadow-none">
          <CardHeader>
            <CardTitle>Response Diffs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.diffs.responses.map((diff) => (
              <DiffBlock key={diff.label} title={diff.label} left={diff.run_a} right={diff.run_b} />
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border border-black/8 shadow-none">
          <CardHeader>
            <CardTitle>Span List Diff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-neutral-800">
            {comparison.diffs.spans.length === 0 ? "No span list changes." : comparison.diffs.spans.map((span) => <div key={span}>{span}</div>)}
          </CardContent>
        </Card>

        <Card className="border border-black/8 shadow-none">
          <CardHeader>
            <CardTitle>Models & Artifact Coverage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-neutral-500">Models</div>
              <div className="flex flex-wrap gap-2">
                {comparison.diffs.models.map((model) => (
                  <span key={model} className="rounded-full border border-black/8 bg-neutral-50 px-3 py-1 text-xs">
                    {model}
                  </span>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {comparison.diffs.artifacts.map((diff) => (
                <DiffBlock key={diff.label} title={diff.label} left={diff.run_a} right={diff.run_b} />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
