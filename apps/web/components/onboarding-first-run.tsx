import Link from "next/link";

type OnboardingFirstRunProps = {
  hasFirstRun: boolean;
  firstRunId?: string | null;
};

export function OnboardingFirstRun({ hasFirstRun, firstRunId }: OnboardingFirstRunProps) {
  return (
    <section className="rounded-3xl border border-blue-200 bg-blue-50 p-6">
      <div className="text-xs uppercase tracking-[0.24em] text-blue-700">First Run</div>
      {hasFirstRun && firstRunId ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-blue-900">Your first trace has landed. Open the run detail page to inspect spans, prompts, and metrics.</p>
          <Link className="inline-flex rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white" href={`/runs/${firstRunId}`}>
            Open first run
          </Link>
        </div>
      ) : (
        <p className="mt-3 text-sm text-blue-900">
          AgentScope is waiting for the first run from your SDK. Once a trace arrives, this flow can redirect you directly into that run.
        </p>
      )}
    </section>
  );
}
