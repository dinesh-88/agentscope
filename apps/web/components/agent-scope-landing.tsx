"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

type AgentScopeLandingProps = {
  isAuthenticated?: boolean;
};

const features = [
  {
    title: "Full Agent Trace",
    description: "See every step, input, and output.",
  },
  {
    title: "Root Cause Analysis",
    description: "Understand why failures happen.",
  },
  {
    title: "Multi-Agent Visibility",
    description: "Track interactions between agents.",
  },
  {
    title: "LLM Observability",
    description: "Monitor prompts, responses, and drift.",
  },
];

const useCases = [
  "Debug AI agents in production",
  "Analyze LLM failures",
  "Monitor multi-agent workflows",
  "Optimize prompt performance",
];

export function AgentScopeLanding({ isAuthenticated = false }: AgentScopeLandingProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0B0F17] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#0B0F17]/80 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-[1368px] items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="AgentScope logo" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="text-lg font-semibold">AgentScope</span>
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
                className="rounded-lg bg-[#7C9EFF] px-4 py-2 text-sm font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
              >
                Go to Dashboard
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-sm text-gray-400 transition-colors hover:text-white">
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-[#7C9EFF] px-4 py-2 text-sm font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
                >
                  Start Free and Send First Trace
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1">
      <section className="px-6 pb-14 pt-20">
        <div className="mx-auto w-full max-w-[1368px] text-center">
          <h1 className="mb-6 bg-gradient-to-br from-white via-white to-gray-400 bg-clip-text text-5xl font-bold text-transparent md:text-7xl">
            Know exactly why your AI agent failed
          </h1>
          <p className="mx-auto mb-8 max-w-3xl text-xl text-gray-400">
            Debug, trace, and optimize multi-agent workflows with real-time LLM observability.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href={isAuthenticated ? "/runs" : "/signup"}
              className="flex items-center gap-2 rounded-lg bg-[#7C9EFF] px-6 py-3 font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
            >
              Debug Your First Agent
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/demo"
              className="rounded-lg border border-[#7C9EFF]/35 bg-[#7C9EFF]/12 px-6 py-3 font-medium text-[#DEE6FF] transition-colors hover:bg-[#7C9EFF]/24"
            >
              View Demo Trace
            </Link>
          </div>
        </div>
      </section>

      <section id="problem" className="px-6 py-16">
        <div className="mx-auto w-full max-w-[1368px] rounded-2xl border border-white/10 bg-white/[0.02] p-8 md:p-10">
          <h2 className="mb-2 text-3xl font-bold">Why AI Agents Fail</h2>
          <p className="mb-6 text-gray-400">AI agents fail in production for reasons that logs don&apos;t explain:</p>
          <ul className="mb-6 space-y-2 text-gray-200">
            <li>Prompt misalignment</li>
            <li>Tool execution failures</li>
            <li>Context drift across steps</li>
            <li>Multi-agent coordination issues</li>
          </ul>
          <p className="text-gray-300">Logs show what happened. AgentScope shows why it happened.</p>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-3 text-3xl font-bold">Observe - Trace - Debug - Fix</h2>
          <ol className="grid gap-4 md:grid-cols-2">
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">1. Capture every agent step</li>
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">2. Trace decisions across workflows</li>
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">3. Detect failure points</li>
            <li className="rounded-xl border border-white/10 bg-white/[0.02] p-5">4. Get root cause insights</li>
          </ol>
        </div>
      </section>

      <section id="features" className="px-6 py-16">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-8 text-3xl font-bold">Features</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
                <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="comparison" className="px-6 py-16">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-6 text-3xl font-bold">Traditional Logs vs AgentScope</h2>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-white/[0.03]">
                  <th className="px-5 py-4 text-sm font-semibold text-gray-200">Traditional Logs</th>
                  <th className="px-5 py-4 text-sm font-semibold text-gray-200">AgentScope</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-white/10">
                  <td className="px-5 py-4 text-gray-400">Shows events</td>
                  <td className="px-5 py-4 text-gray-200">Explains failures</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-5 py-4 text-gray-400">Hard to debug</td>
                  <td className="px-5 py-4 text-gray-200">Root cause insights</td>
                </tr>
                <tr className="border-t border-white/10">
                  <td className="px-5 py-4 text-gray-400">Fragmented</td>
                  <td className="px-5 py-4 text-gray-200">Unified trace</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-5 text-3xl font-bold">Use Cases</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {useCases.map((item) => (
              <li key={item} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-gray-200">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-6 pb-24 pt-10">
        <div className="mx-auto w-full max-w-[1368px] rounded-3xl border border-white/10 bg-white/[0.02] px-8 py-14 text-center">
          <h2 className="mb-4 text-4xl font-bold md:text-5xl">Start debugging your AI agents today.</h2>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href={isAuthenticated ? "/runs" : "/signup"}
              className="rounded-lg bg-[#7C9EFF] px-7 py-3 font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
            >
              Debug Your First Agent
            </Link>
            <Link
              href="/demo"
              className="rounded-lg border border-white/20 px-7 py-3 font-medium transition-colors hover:bg-white/5"
            >
              View Demo Trace
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
              <p className="text-sm text-gray-400">Debug and optimize your AI agents with confidence.</p>
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
