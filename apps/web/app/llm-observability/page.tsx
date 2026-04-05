import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "LLM Observability Explained",
  description:
    "Understand LLM observability, why it matters for production AI systems, and which metrics help you diagnose failures fast.",
  alternates: {
    canonical: "/llm-observability",
  },
};

export default function LLMObservabilityPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <article className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">LLM Observability Explained</h1>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">What is LLM observability</h2>
            <p>LLM observability is the practice of tracking model behavior across prompts, context, tools, and outputs to understand how decisions were made.</p>
            <p>It combines traces, performance signals, and error visibility into one operational view.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Why it matters</h2>
            <p>Without observability, AI reliability work is reactive and slow. Teams see bad outputs but cannot prove why they happened.</p>
            <p>Observability reduces mean time to detect and mean time to resolution for AI incidents.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Key metrics (latency, drift, errors)</h2>
            <p>Track latency by step, quality drift over time, tool-call error rates, and token usage patterns.</p>
            <p>These metrics reveal where performance degrades before user impact becomes severe.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Observability vs logging</h2>
            <p>Logging records isolated events. Observability connects those events into causal chains with context.</p>
            <p>For AI systems, that difference is critical because failures often emerge from interaction effects across many steps.</p>
          </section>

          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Related Pages</h2>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <Link href="/" className="text-blue-400 hover:text-blue-300">
                Homepage
              </Link>
              <Link href="/ai-agent-tracing" className="text-blue-400 hover:text-blue-300">
                AI Agent Tracing Guide
              </Link>
              <Link href="/why-ai-agents-fail" className="text-blue-400 hover:text-blue-300">
                Why AI Agents Fail
              </Link>
            </div>
          </section>
        </article>
      </main>
    </MarketingShell>
  );
}
