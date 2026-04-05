import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export const metadata: Metadata = {
  title: "How to Debug AI Agents",
  description:
    "A practical workflow for debugging AI agents in production, from issue detection to root-cause validation and verified fixes.",
  alternates: {
    canonical: "/debug-ai-agents",
  },
};

export default function DebugAIAgentsPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <article className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">How to Debug AI Agents</h1>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Debugging challenges</h2>
            <p>AI agent failures are multi-layered: model behavior, retrieval quality, tool stability, and orchestration logic can all contribute.</p>
            <p>This complexity makes single-point debugging approaches unreliable.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Step-by-step debugging workflow</h2>
            <p>Start with a failing run, inspect the full execution timeline, isolate the first abnormal transition, then compare against a healthy baseline run.</p>
            <p>After changing prompts, tools, or policy logic, validate the fix on equivalent production-like inputs.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">Tools vs observability</h2>
            <p>Developer tools help inspect code and systems, but observability shows runtime behavior and causal relationships.</p>
            <p>You need both: tools to fix, observability to find and verify.</p>
          </section>

          <section className="mt-8 space-y-4 text-gray-300">
            <h2 className="text-2xl font-semibold text-white">AgentScope walkthrough</h2>
            <p>AgentScope surfaces span-level traces, timing, prompt context, and tool outcomes in one interface so failures are easier to localize.</p>
            <p>It turns debugging from guesswork into a repeatable engineering process.</p>
          </section>

          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Related Pages</h2>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <Link href="/" className="text-blue-400 hover:text-blue-300">
                Homepage
              </Link>
              <Link href="/why-ai-agents-fail" className="text-blue-400 hover:text-blue-300">
                Why AI Agents Fail
              </Link>
              <Link href="/ai-agent-tracing" className="text-blue-400 hover:text-blue-300">
                AI Agent Tracing Guide
              </Link>
            </div>
          </section>
        </article>
      </main>
    </MarketingShell>
  );
}
