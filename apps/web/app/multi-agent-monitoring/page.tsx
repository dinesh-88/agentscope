import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "Multi-Agent Workflow Monitoring",
  description:
    "Monitor complex multi-agent workflows with tracing that captures handoffs, tool calls, timing, and root-cause evidence.",
  alternates: {
    canonical: "/multi-agent-monitoring",
  },
};

export default function MultiAgentMonitoringPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <article className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Multi-Agent Workflow Monitoring</h1>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Complexity of multi-agent systems</h2>
            <p>Multi-agent architectures add specialization and scale, but also introduce more dependencies and state transitions.</p>
            <p>A single degraded agent can propagate bad context across the entire workflow.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Failure points</h2>
            <p>Typical failures include broken handoffs, inconsistent tool schemas, asynchronous race conditions, and missing guardrails.</p>
            <p>These often appear as intermittent quality issues that are hard to reproduce from logs alone.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Need for tracing</h2>
            <p>Tracing captures each agent decision and dependency path so teams can inspect execution order, payload flow, and timing.</p>
            <p>It provides the shared source of truth needed for incident analysis across teams.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">AgentScope solution</h2>
            <p>AgentScope unifies multi-agent traces into a single run timeline, making it easier to identify where collaboration breaks down.</p>
            <p>With root-cause context and replay-ready evidence, teams can ship fixes faster and avoid repeated regressions.</p>
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
              <Link href="/debug-ai-agents" className="text-blue-400 hover:text-blue-300">
                How to Debug AI Agents
              </Link>
            </div>
          </section>
        </article>
      </main>
    </MarketingShell>
  );
}
