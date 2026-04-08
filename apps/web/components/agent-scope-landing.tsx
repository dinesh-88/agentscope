"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

type AgentScopeLandingProps = {
  isAuthenticated?: boolean;
};

const useCases = [
  "Debug AI agents in production",
  "Monitor multi-agent workflows",
  "Analyze LLM failures",
  "Optimize prompt performance",
];

export function AgentScopeLanding({ isAuthenticated = false }: AgentScopeLandingProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0B0F17] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#0B0F17]/80 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-[1368px] items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="AgentScope logo" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="text-base font-semibold sm:text-lg">AgentScope</span>
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-1 rounded-full border border-white/5 bg-white/5 p-1 text-sm md:flex">
              <Link href="/features" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Features
              </Link>
              <Link href="/demo" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Demo
              </Link>
              <Link href="/pricing" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Pricing
              </Link>
              <Link href="/docs" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Docs
              </Link>
            </div>

            {isAuthenticated ? (
              <Link
                href="/dashboard"
                data-cta-track="true"
                data-cta-location="nav"
                data-cta-text="Go to Dashboard"
                className="rounded-lg bg-[#7C9EFF] px-3 py-2 text-xs font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC] sm:px-4 sm:text-sm"
              >
                Go to Dashboard
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-xs text-gray-400 transition-colors hover:text-white sm:text-sm">
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  data-cta-track="true"
                  data-cta-location="nav"
                  data-cta-text="Start Free and Send First Trace"
                  className="rounded-lg bg-[#7C9EFF] px-3 py-2 text-xs font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC] sm:px-4 sm:text-sm"
                >
                  <span className="sm:hidden">Start Free</span>
                  <span className="hidden sm:inline">Start Free and Send First Trace</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1">
        <section className="px-4 pb-12 pt-16 sm:px-6 sm:pb-14 sm:pt-20">
          <div className="mx-auto w-full max-w-[1368px] text-center">
            <h1 className="mb-6 bg-gradient-to-br from-white via-white to-gray-400 bg-clip-text text-4xl font-bold text-transparent sm:text-5xl md:text-7xl">
              Know exactly why your AI agent failed
            </h1>
            <p className="mx-auto mb-8 max-w-4xl text-base text-gray-400 sm:text-xl">
              AgentScope is an AI agent observability platform that helps you trace, debug, and optimize multi-agent workflows in real
              time.
            </p>
            <div className="mb-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <Link
                href={isAuthenticated ? "/runs" : "/signup"}
                data-cta-track="true"
                data-cta-location="hero"
                data-cta-text="Debug Your First Agent"
                className="flex items-center justify-center gap-2 rounded-lg bg-[#7C9EFF] px-6 py-3 font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
              >
                Debug Your First Agent
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/demo"
                data-cta-track="true"
                data-cta-location="hero"
                data-cta-text="View Live Trace"
                className="rounded-lg border border-[#7C9EFF]/35 bg-[#7C9EFF]/12 px-6 py-3 text-center font-medium text-[#DEE6FF] transition-colors hover:bg-[#7C9EFF]/24"
              >
                View Live Trace
              </Link>
            </div>
            <p className="text-sm text-gray-400">Works with OpenAI, LangChain, and custom multi-agent systems.</p>
          </div>
        </section>

        <section className="px-4 py-8 sm:px-6">
          <div className="mx-auto w-full max-w-[1368px] rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-5 text-center text-sm font-medium text-gray-200">
            Used by developers building production AI agents
          </div>
        </section>

        <section id="problem" className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px] rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-10">
            <h2 className="mb-4 text-2xl font-bold md:text-3xl">AI Agents Fail - And Logs Don&apos;t Tell You Why</h2>
            <p className="mb-6 text-gray-300">In production, AI agents break in ways that are hard to debug:</p>
            <ul className="mb-6 grid gap-3 text-gray-200 md:grid-cols-2">
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Prompts behave unpredictably</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Tools fail silently</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Context drifts across steps</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Multi-agent workflows become opaque</li>
            </ul>
            <p className="text-gray-400">Logs show events. They don&apos;t explain decisions.</p>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px] rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-10">
            <h2 className="mb-3 text-2xl font-bold md:text-3xl">From Logs -&gt; Full Observability</h2>
            <p className="mb-6 text-gray-300">AgentScope gives you complete visibility into your AI system:</p>
            <ul className="grid gap-3 text-gray-200 md:grid-cols-2">
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Trace every step of every agent</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Inspect prompts, outputs, and tool calls</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Detect where things go wrong</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Understand why failures happen</li>
            </ul>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px]">
            <h2 className="mb-3 text-2xl font-bold md:text-3xl">Observe -&gt; Trace -&gt; Debug -&gt; Fix</h2>
            <ol className="grid gap-4 md:grid-cols-2">
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">1. Capture every agent interaction</li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">2. Visualize full execution traces</li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">3. Identify failure points instantly</li>
              <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">4. Optimize prompts and workflows</li>
            </ol>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px] space-y-6">
            <div className="rounded-3xl border border-[#1D2B4D] bg-[#0A0F1D] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-10">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-bold md:text-3xl">See What Your Agent Actually Did</h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
                  <span className="rounded-md border border-[#31456F] bg-[#0D1730] px-2 py-1">Timeline</span>
                  <span className="rounded-md border border-[#31456F] bg-[#0D1730] px-2 py-1">Step Details</span>
                  <span className="rounded-md border border-[#31456F] bg-[#0D1730] px-2 py-1">47.3s total</span>
                </div>
              </div>
              <p className="mb-5 text-gray-300">Track the exact execution path, timing, and model decisions for every run.</p>
              <div className="mb-6 overflow-hidden rounded-2xl border border-[#233458] bg-[#040A18]">
                <div className="grid min-h-[360px] grid-cols-1 md:grid-cols-[1fr_320px]">
                  <div className="relative border-b border-[#162642] md:border-b-0 md:border-r">
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(65,99,161,0.15)_1px,transparent_1px),linear-gradient(90deg,rgba(65,99,161,0.15)_1px,transparent_1px)] bg-[size:46px_46px]" />
                    <div className="relative p-4">
                      <div className="mb-4 text-xs uppercase tracking-wide text-gray-400">Execution Timeline</div>
                      <div className="space-y-3">
                        <div className="h-9 rounded-md bg-[#081633] p-1">
                          <div className="h-full w-[28%] rounded bg-[#3B82F6]/90 px-2 py-1 text-xs text-white">llm_call - 6936.6ms</div>
                        </div>
                        <div className="h-9 rounded-md bg-[#081633] p-1">
                          <div className="ml-[35%] h-full w-[30%] rounded bg-[#3B82F6]/90 px-2 py-1 text-xs text-white">llm_call - 6503.1ms</div>
                        </div>
                        <div className="h-9 rounded-md bg-[#081633] p-1">
                          <div className="ml-[52%] h-full w-[24%] rounded bg-[#60A5FA]/90 px-2 py-1 text-xs text-white">llm_call - 4133.7ms</div>
                        </div>
                        <div className="h-9 rounded-md bg-[#081633] p-1">
                          <div className="ml-[66%] h-full w-[26%] rounded bg-[#3B82F6]/90 px-2 py-1 text-xs text-white">llm_call - 6899.7ms</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-[#030916] p-4">
                    <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">Step Details</div>
                    <div className="mb-4 rounded-lg border border-[#1A2A4B] bg-[#071025] p-3">
                      <div className="mb-2 text-sm font-semibold text-white">llm_call</div>
                      <div className="space-y-1 text-xs text-gray-300">
                        <div className="flex items-start justify-between gap-2"><span>Status</span><span className="text-right">success (system)</span></div>
                        <div className="flex items-start justify-between gap-2"><span>Duration</span><span className="text-right">4134 ms</span></div>
                        <div className="flex items-start justify-between gap-2"><span>Tokens</span><span className="text-right">463</span></div>
                        <div className="flex items-start justify-between gap-2"><span>Cost</span><span className="text-right">$0.0002</span></div>
                      </div>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="rounded-md border border-[#1A2A4B] bg-[#071025] p-2 text-gray-300">PROMPT: structured view</div>
                      <div className="rounded-md border border-[#1A2A4B] bg-[#071025] p-2 text-gray-300">RAW JSON payload</div>
                      <div className="rounded-md border border-[#1A2A4B] bg-[#071025] p-2 text-gray-300">RESPONSE preview</div>
                    </div>
                  </div>
                </div>
              </div>
              <ul className="grid gap-3 text-gray-200 md:grid-cols-3">
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Step-by-step execution timeline</li>
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Prompt + response inspection</li>
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Tool usage tracking</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-[#1D2B4D] bg-[#0A0F1D] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:p-10">
              <h2 className="mb-2 text-2xl font-bold md:text-3xl">Find the Root Cause Faster</h2>
              <p className="mb-5 text-gray-300">Pinpoint why runs degrade with ranked insights and concrete fix guidance.</p>
              <div className="mb-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-[#22345A] bg-[#0B1328] p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Performance Slow Span</h3>
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200">MEDIUM</span>
                  </div>
                  <div className="space-y-2 text-sm text-gray-300">
                    <p>Latency is elevated (avg 6525 ms, p95 8154 ms).</p>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Cause</p>
                    <p>Critical LLM spans are bottlenecking overall run completion time.</p>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Fix</p>
                    <p>Profile slow spans and reduce model/tool work on critical paths.</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#22345A] bg-[#0B1328] p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Missing Instructions</h3>
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200">MEDIUM</span>
                  </div>
                  <div className="space-y-2 text-sm text-gray-300">
                    <p>No instruction files or runtime instruction overrides were captured.</p>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Cause</p>
                    <p>Instruction context is missing from telemetry and execution snapshots.</p>
                    <p className="text-xs uppercase tracking-wide text-gray-400">Fix</p>
                    <p>Load instruction files and include explicit runtime system prompts.</p>
                  </div>
                </div>
              </div>
              <ul className="grid gap-3 text-gray-200 md:grid-cols-4">
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Failure detection</li>
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Drift analysis</li>
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Hallucination + schema optimization</li>
                <li className="rounded-full border border-[#29406A] bg-[#0C152B] px-4 py-2 text-sm">Suggested fixes</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="comparison" className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px]">
            <h2 className="mb-6 text-2xl font-bold md:text-3xl">Why Logs Are Not Enough</h2>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="bg-white/[0.03]">
                    <th className="px-5 py-4 text-sm font-semibold text-gray-200">Traditional Logs</th>
                    <th className="px-5 py-4 text-sm font-semibold text-gray-200">AgentScope</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-white/10">
                    <td className="px-5 py-4 text-gray-400">Raw outputs</td>
                    <td className="px-5 py-4 text-gray-200">Structured traces</td>
                  </tr>
                  <tr className="border-t border-white/10">
                    <td className="px-5 py-4 text-gray-400">Hard to follow</td>
                    <td className="px-5 py-4 text-gray-200">Visual workflows</td>
                  </tr>
                  <tr className="border-t border-white/10">
                    <td className="px-5 py-4 text-gray-400">No root cause</td>
                    <td className="px-5 py-4 text-gray-200">Failure insights</td>
                  </tr>
                  <tr className="border-t border-white/10">
                    <td className="px-5 py-4 text-gray-400">Fragmented</td>
                    <td className="px-5 py-4 text-gray-200">Unified system view</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px]">
            <h2 className="mb-5 text-2xl font-bold md:text-3xl">Built for Real AI Systems</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {useCases.map((item) => (
                <li key={item} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-gray-200">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 md:py-16">
          <div className="mx-auto w-full max-w-[1368px] rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-10">
            <h2 className="mb-3 text-2xl font-bold md:text-3xl">AI Agent Debugging &amp; LLM Observability</h2>
            <p className="mb-5 text-gray-300">AgentScope helps teams solve:</p>
            <ul className="mb-5 grid gap-3 text-gray-200 md:grid-cols-2">
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">AI agent debugging</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">LLM observability</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">Multi-agent workflow monitoring</li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3">AI system failure analysis</li>
            </ul>
            <p className="text-gray-400">
              If your AI agent is failing and you don&apos;t know why - AgentScope helps you find the answer.
            </p>
          </div>
        </section>

        <section className="px-4 pb-20 pt-10 sm:px-6 sm:pb-24">
          <div className="mx-auto w-full max-w-[1368px] rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-12 text-center sm:px-8 sm:py-14">
            <h2 className="mb-3 text-3xl font-bold md:text-5xl">Stop Guessing. Start Debugging.</h2>
            <p className="mb-6 text-base text-gray-300 sm:text-lg">Understand your AI agents at every step.</p>
            <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <Link
                href={isAuthenticated ? "/runs" : "/signup"}
                data-cta-track="true"
                data-cta-location="footer"
                data-cta-text="Debug Your First Agent"
                className="rounded-lg bg-[#7C9EFF] px-7 py-3 text-center font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
              >
                Debug Your First Agent
              </Link>
              <Link
                href="/demo"
                data-cta-track="true"
                data-cta-location="footer"
                data-cta-text="View Live Demo"
                className="rounded-lg border border-white/20 px-7 py-3 text-center font-medium transition-colors hover:bg-white/5"
              >
                View Live Demo
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 px-6 py-12">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-8 grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <Image src="/logo.svg" alt="AgentScope logo" width={32} height={32} className="h-8 w-8 rounded-lg" />
                <span className="font-semibold">AgentScope</span>
              </div>
              <p className="text-sm text-gray-400">AgentScope - Understand why your AI agents fail.</p>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/features" className="transition-colors hover:text-white">Features</Link></li>
                <li><Link href="/pricing" className="transition-colors hover:text-white">Pricing</Link></li>
                <li><Link href="/docs" className="transition-colors hover:text-white">Docs</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/docs" className="transition-colors hover:text-white">About</Link></li>
                <li><Link href="/demo" className="transition-colors hover:text-white">Product Tour</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><Link href="/legal/privacy" className="transition-colors hover:text-white">Privacy</Link></li>
                <li><Link href="/legal/terms" className="transition-colors hover:text-white">Terms</Link></li>
                <li><Link href="/docs/security" className="transition-colors hover:text-white">Security</Link></li>
                <li><Link href="/status" className="transition-colors hover:text-white">Status</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 text-sm text-gray-400">© 2026 AgentScope. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
