import Link from "next/link";

import { ArrowRight, PlayCircle } from "lucide-react";

import { MarketingShell } from "@/components/marketing-shell";

export default async function DemoPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">90-second product tour</h1>
            <p className="mt-3 max-w-3xl text-lg text-gray-400">
              See a failed run, root-cause explanation, and a suggested fix in one short walkthrough.
            </p>
          </div>

          <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/70 to-gray-800/60 p-8">
            <div className="flex aspect-video items-center justify-center rounded-xl border border-white/10 bg-black/40">
              <div className="text-center">
                <PlayCircle className="mx-auto h-14 w-14 text-blue-400" />
                <p className="mt-3 text-sm text-gray-300">Product tour video placeholder</p>
                <p className="mt-1 text-xs text-gray-500">Drop in a hosted MP4 or Loom embed here.</p>
              </div>
            </div>
            <ol className="mt-6 grid gap-3 text-sm text-gray-300 md:grid-cols-3">
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">1. Inspect failed run timeline and token usage</li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">2. Open root cause with evidence and confidence score</li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">3. Apply fix and compare before vs after</li>
            </ol>
          </section>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 font-medium transition-opacity hover:opacity-90"
            >
              Start Free and Send First Trace
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-sm text-gray-500">No credit card. First trace in about 3 minutes.</p>
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}
