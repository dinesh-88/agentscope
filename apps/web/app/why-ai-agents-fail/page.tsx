import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "Why AI Agents Fail (And How to Fix Them)",
  description:
    "Learn the common reasons AI agents fail in production and how to fix reliability issues with end-to-end tracing and observability.",
  alternates: {
    canonical: "/why-ai-agents-fail",
  },
};

export default function WhyAIAgentsFailPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <article className="mx-auto w-full max-w-[1368px]">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Why AI Agents Fail (And How to Fix Them)</h1>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Common failure types</h2>
            <p>AI agents most often fail through tool misuse, bad context selection, prompt drift, and hidden handoff errors between steps.</p>
            <p>These failures are hard to catch because final outputs can look valid even when intermediate reasoning was wrong.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Why logs are insufficient</h2>
            <p>Traditional logs show events, not causality. They rarely expose the model prompt, retrieval payload, tool inputs, and output transitions together.</p>
            <p>Without trace context, teams spend hours guessing which step introduced the issue.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Real-world failure examples</h2>
            <p>An agent returns outdated policy guidance after retrieving stale context. Another agent times out because a tool call retries silently and blocks downstream steps.</p>
            <p>In both cases, the visible symptom appears late, while the root cause sits earlier in the run.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">How AgentScope solves this</h2>
            <p>AgentScope links prompts, tool calls, latency, and errors into one trace timeline so you can isolate root cause quickly.</p>
            <p>Teams can move from incident detection to verified fix faster, with less manual correlation work.</p>
          </section>

          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Related Pages</h2>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <Link href="/" className="text-blue-400 hover:text-blue-300">
                Homepage
              </Link>
              <Link href="/debug-ai-agents" className="text-blue-400 hover:text-blue-300">
                How to Debug AI Agents
              </Link>
              <Link href="/llm-observability" className="text-blue-400 hover:text-blue-300">
                LLM Observability Explained
              </Link>
            </div>
          </section>
        </article>
      </main>
    </MarketingShell>
  );
}
