import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "AI Agent Tracing Guide",
  description:
    "A practical guide to AI agent tracing, including trace fundamentals, breakdown examples, and visualization benefits.",
  alternates: {
    canonical: "/ai-agent-tracing",
  },
};

export default function AIAgentTracingPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <article className="mx-auto w-full max-w-[1368px]">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">AI Agent Tracing Guide</h1>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">What is tracing</h2>
            <p>Tracing records each operation in an agent run, including prompt generation, context retrieval, tool calls, and final outputs.</p>
            <p>It preserves execution order and dependency relationships between steps.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Why tracing matters</h2>
            <p>Without tracing, teams only see symptoms. With tracing, they can identify exactly where behavior diverged from expectations.</p>
            <p>This shortens debugging cycles and improves confidence in production changes.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Example trace breakdown</h2>
            <p>A trace can show the planner agent selecting the wrong tool, the retrieval step returning low-quality context, and the response agent compounding the error.</p>
            <p>Because every step is connected, root cause becomes measurable instead of speculative.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Visualization benefits</h2>
            <p>Visual timelines help engineers and product teams align on what happened, why it happened, and what to change next.</p>
            <p>This shared debugging surface improves incident response across the entire AI stack.</p>
          </section>

          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Related Pages</h2>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <Link href="/" className="text-blue-400 hover:text-blue-300">
                Homepage
              </Link>
              <Link href="/llm-observability" className="text-blue-400 hover:text-blue-300">
                LLM Observability Explained
              </Link>
              <Link href="/multi-agent-monitoring" className="text-blue-400 hover:text-blue-300">
                Multi-Agent Workflow Monitoring
              </Link>
            </div>
          </section>
        </article>
      </main>
    </MarketingShell>
  );
}
