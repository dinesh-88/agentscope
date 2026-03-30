"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { mockTraceSpans } from "@/components/mock-trace-data";
import { TraceView } from "@/components/trace-view";
import {
  Activity,
  ArrowRight,
  Copy,
  Github,
  Play,
  Shield,
  Sparkles,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
} from "recharts";

type AgentScopeLandingProps = {
  isAuthenticated?: boolean;
};

export function AgentScopeLanding({ isAuthenticated = false }: AgentScopeLandingProps) {
  const [activeTab, setActiveTab] = useState<"python" | "typescript">("python");
  const [copiedQuickstart, setCopiedQuickstart] = useState(false);

  const tokenUsageData = [
    { day: "Mon", tokens: 145000 },
    { day: "Tue", tokens: 132000 },
    { day: "Wed", tokens: 158000 },
    { day: "Thu", tokens: 142000 },
    { day: "Fri", tokens: 128000 },
    { day: "Sat", tokens: 95000 },
    { day: "Sun", tokens: 87000 },
  ];

  const costData = [
    { run: "1", cost: 0.24 },
    { run: "2", cost: 0.31 },
    { run: "3", cost: 0.18 },
    { run: "4", cost: 0.42 },
    { run: "5", cost: 0.29 },
    { run: "6", cost: 0.22 },
  ];

  const latencyData = [
    { time: "00:00", latency: 1.2 },
    { time: "04:00", latency: 1.1 },
    { time: "08:00", latency: 1.5 },
    { time: "12:00", latency: 1.8 },
    { time: "16:00", latency: 1.4 },
    { time: "20:00", latency: 1.3 },
  ];

  const quickstartCommand =
    activeTab === "python"
      ? `pip install agentscope-sdk
export AGENTSCOPE_API_KEY=proj_live_xxx
python - <<'PY'
import os
import agentscope

os.environ["AGENTSCOPE_API_KEY"] = os.getenv("AGENTSCOPE_API_KEY", "")
agentscope.auto_instrument()
print("trace received: run_01H...")
PY`
      : `npm install @agentscope/sdk
export AGENTSCOPE_API_KEY=proj_live_xxx
node -e '
const { AgentScope } = require("@agentscope/sdk");
new AgentScope({ apiKey: process.env.AGENTSCOPE_API_KEY });
console.log("trace received: run_01H...");
'`;

  async function copyQuickstart() {
    await navigator.clipboard.writeText(quickstartCommand);
    setCopiedQuickstart(true);
    window.setTimeout(() => setCopiedQuickstart(false), 1500);
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/5 bg-[#0B0F17]/80 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-[1368px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.svg" alt="AgentScope logo" width={32} height={32} className="h-8 w-8 rounded-lg" />
              <span className="text-lg font-semibold">AgentScope</span>
            </Link>
          </div>

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
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-lg bg-[#7C9EFF] px-4 py-2 text-sm font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
                >
                  Go to Dashboard
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login" className="text-sm text-gray-400 transition-colors hover:text-white">
                  Sign In
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-[#7C9EFF] px-4 py-2 text-sm font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
                >
                  Start Free
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      <section className="px-6 pt-20 pb-12">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-6 bg-gradient-to-br from-white via-white to-gray-400 bg-clip-text text-5xl font-bold text-transparent md:text-7xl">
              Your AI agent failed. AgentScope shows you why.
            </h1>
            <p className="mx-auto mb-8 max-w-3xl text-xl text-gray-400">
              Trace every step, pinpoint the root cause, see the fix, and understand token cost — without digging through logs.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href={isAuthenticated ? "/runs" : "/demo"}
                data-testid="run-demo-button"
                className="flex items-center gap-2 rounded-lg border border-[#7C9EFF]/35 bg-[#7C9EFF]/14 px-6 py-3 font-medium text-[#DEE6FF] transition-colors hover:bg-[#7C9EFF]/24"
              >
                <Play className="h-4 w-4" />
                Run Demo
              </Link>
              <Link
                href={isAuthenticated ? "/dashboard" : "/signup"}
                className="flex items-center gap-2 rounded-lg bg-[#7C9EFF] px-6 py-3 font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
              >
                Start Free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {!isAuthenticated ? <p className="mt-3 text-sm text-gray-500">No credit card. First trace in about 3 minutes.</p> : null}
          </div>
        </div>
      </section>

      <section className="px-6 pb-18 pt-6">
        <div className="mx-auto w-full max-w-[1368px]">
          <p className="mb-6 text-center text-sm font-medium tracking-wide text-[#AFC0FF]">
            Logs tell you what happened. AgentScope tells you why.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.04] p-6">
              <h3 className="mb-4 text-xl font-semibold text-red-200">Without AgentScope</h3>
              <ul className="space-y-3 text-sm text-gray-300">
                <li>Scroll logs and traces</li>
                <li>Inspect prompts and tool calls manually</li>
                <li>Guess which step broke</li>
                <li>Waste time rerunning flows</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-[#7C9EFF]/30 bg-[#7C9EFF]/[0.06] p-6">
              <h3 className="mb-4 text-xl font-semibold text-[#DDE5FF]">With AgentScope</h3>
              <ul className="space-y-3 text-sm text-gray-200">
                <li>See the exact failure point</li>
                <li>Get reason, cause, and fix</li>
                <li>Understand token and cost impact</li>
                <li>Debug in minutes instead of hours</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-transparent px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mx-auto mb-12 max-w-4xl text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">AI agents fail in ways logs don’t explain</h2>
            <p className="text-lg text-gray-400">
              When an agent breaks, developers jump between traces, prompts, tool outputs, and model responses trying to reconstruct what happened. The problem isn’t visibility alone — it’s explanation.
            </p>
          </div>

          <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
            {[
              "Why did the agent fail?",
              "Which prompt or tool caused it?",
              "Why did cost spike?",
              "What should I change?",
            ].map((problem) => (
              <div key={problem} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#7C9EFF]/40 bg-[#7C9EFF]/20">
                  <span className="text-[10px] text-[#C8D5FF]">?</span>
                </div>
                <p className="text-sm text-gray-200">{problem}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-14 text-center text-3xl font-bold md:text-4xl">Built for AI debugging outcomes, not just telemetry</h2>

          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                icon: Activity,
                title: "Run tracing",
                copy: "See every LLM call, tool call, and span in one timeline.",
              },
              {
                icon: Sparkles,
                title: "Root cause analysis",
                copy: "Go from failure to explanation, not just raw telemetry.",
              },
              {
                icon: Zap,
                title: "Optimization insights",
                copy: "Get actionable suggestions to reduce cost and improve reliability.",
              },
              {
                icon: TrendingDown,
                title: "Cost visibility",
                copy: "Track token usage and cost at the run level.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-7">
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#7C9EFF]/20">
                  <item.icon className="h-5 w-5 text-[#AFC0FF]" />
                </div>
                <h3 className="mb-2 text-xl font-semibold">{item.title}</h3>
                <p className="text-sm text-gray-400">{item.copy}</p>
              </div>
            ))}

            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-7 md:col-span-2">
              <div className="pointer-events-none absolute -top-20 -right-16 h-44 w-44 rounded-full bg-[#7C9EFF]/16 blur-3xl" />
              <div className="relative grid gap-6 lg:grid-cols-[1fr_1.2fr]">
                <div>
                  <h3 className="mb-3 text-xl font-semibold">Live debugging signal</h3>
                  <p className="mb-4 text-sm text-gray-300">
                    Keep your debugging loop tight with fast live updates while runs are still in progress.
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#7C9EFF]/25 bg-[#7C9EFF]/10 px-3 py-1 text-xs text-[#AFC0FF]">
                    <span className="relative inline-flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7C9EFF] opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7C9EFF]" />
                    </span>
                    Real-time run updates
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                    <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                      <span>Workflow Graph</span>
                      <span className="text-[#7C9EFF]">running</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5">
                        <span className="h-2 w-2 rounded-full bg-slate-500" />
                        <span className="text-xs text-slate-300">input.parse</span>
                      </div>
                      <div className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#7C9EFF]" />
                        <span className="text-xs text-[#C9D6FF]">planner.llm_call</span>
                      </div>
                      <div className="flex items-center gap-2 rounded bg-white/[0.03] px-2 py-1.5">
                        <span className="h-2 w-2 rounded-full bg-[#7C9EFF]" />
                        <span className="text-xs text-[#C9D6FF]">tool.search</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                    <div className="mb-2 text-xs text-slate-400">Live Logs</div>
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <p className="text-slate-400">[10:24:41] span_started planner.llm_call</p>
                      <p className="text-[#AFC0FF] motion-safe:animate-pulse">[10:24:41] token_stream +42</p>
                      <p className="text-slate-400">[10:24:42] artifact_created prompt.rendered</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="demo" className="bg-transparent px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-10 text-center">
            <h2 className="mb-3 text-3xl font-bold md:text-4xl">See a broken run explained</h2>
            <p className="text-gray-400">Example: a chatbot fails after a tool returns invalid output.</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <TraceView spans={mockTraceSpans} title="Failed Run #1247" className="dark" />
            </div>

            <div className="grid gap-4">
              {[
                {
                  title: "Reason",
                  body: "The run failed because the downstream tool response could not be parsed.",
                },
                {
                  title: "Cause",
                  body: "The tool returned an invalid schema with a missing required field.",
                },
                {
                  title: "Fix",
                  body: "Add response validation and retry or fallback logic before passing tool output back into the agent.",
                },
                {
                  title: "Cost",
                  body: "4,230 tokens spent before failure.",
                },
              ].map((card) => (
                <div key={card.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[#AFC0FF]">{card.title}</h4>
                  <p className="text-sm text-gray-300">{card.body}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-6 text-center text-sm text-gray-400">This is the difference between telemetry and understanding.</p>
        </div>
      </section>

      <section id="docs" className="px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">Send your first trace in minutes</h2>
          <p className="mb-12 text-center text-gray-400">
            Install the SDK, add your API key, and start seeing runs with root-cause insights right away.
          </p>

          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={() => setActiveTab("python")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "python" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Python
            </button>
            <button
              onClick={() => setActiveTab("typescript")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "typescript" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              TypeScript
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10 bg-gray-900">
            <div className="flex items-center justify-between border-b border-white/10 bg-gray-800/50 px-4 py-2">
              <span className="text-xs text-gray-500">quickstart.sh</span>
              <button className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white" onClick={copyQuickstart} type="button">
                <Copy className="h-3 w-3" />
                {copiedQuickstart ? "Copied" : "Copy Full Quickstart"}
              </button>
            </div>
            <div className="p-6 font-mono text-sm">
              {activeTab === "python" ? (
                <pre className="text-gray-300">
                  <span className="text-gray-500"># 1) Install SDK</span>
                  {"\n"}pip install agentscope-sdk
                  {"\n\n"}
                  <span className="text-gray-500"># 2) Add your API key</span>
                  {"\n"}export AGENTSCOPE_API_KEY=proj_live_xxx
                  {"\n\n"}
                  <span className="text-gray-500"># 3) Send a minimal trace</span>
                  {"\n"}
                  <span className="text-[#7C9EFF]">import</span> os
                  {"\n"}
                  <span className="text-[#7C9EFF]">import</span> agentscope
                  {"\n\n"}os.environ[<span className="text-[#7C9EFF]">{`"AGENTSCOPE_API_KEY"`}</span>] = os.getenv(
                  <span className="text-[#7C9EFF]">{`"AGENTSCOPE_API_KEY"`}</span>, <span className="text-[#7C9EFF]">{`""`}</span>)
                  {"\n"}agentscope.auto_instrument()
                  {"\n"}<span className="text-[#7C9EFF]">print</span>(
                  <span className="text-[#7C9EFF]">{`"trace received: run_01H..."`}</span>)
                </pre>
              ) : (
                <pre className="text-gray-300">
                  <span className="text-gray-500">{"// 1) Install SDK"}</span>
                  {"\n"}npm install @agentscope/sdk
                  {"\n\n"}
                  <span className="text-gray-500">{"// 2) Add your API key"}</span>
                  {"\n"}export AGENTSCOPE_API_KEY=proj_live_xxx
                  {"\n\n"}
                  <span className="text-gray-500">{"// 3) Send a minimal trace"}</span>
                  {"\n"}
                  <span className="text-[#7C9EFF]">import</span> {"{ AgentScope }"} <span className="text-[#7C9EFF]">from</span> <span className="text-[#7C9EFF]">{"'@agentscope/sdk'"}</span>;
                  {"\n"}<span className="text-[#7C9EFF]">new</span> AgentScope({"{"} apiKey: process.env.AGENTSCOPE_API_KEY {"}"});
                  {"\n"}console.log(<span className="text-[#7C9EFF]">{`"trace received: run_01H..."`}</span>);
                </pre>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-white/10 bg-gray-800/30 px-4 py-3 text-sm">
              <Link href="/signup" className="text-[#7C9EFF] transition-colors hover:text-[#AFC0FF]">
                Start Free and Send First Trace
              </Link>
              <Link href="/demo" className="text-gray-300 transition-colors hover:text-white">
                Run Demo
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-transparent px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">Every failed run is also wasted cost</h2>
            <p className="text-lg text-gray-400">
              Track token usage, latency, and run-level cost so you can spot expensive failures and reduce waste.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Token usage</h3>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={tokenUsageData}>
                  <Area type="monotone" dataKey="tokens" stroke="#7C9EFF" fill="#7C9EFF" fillOpacity={0.18} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <div className="text-2xl font-bold">987K</div>
                <div className="text-xs text-gray-500">tokens this week</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Avg cost per run</h3>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={costData}>
                  <Bar dataKey="cost" fill="#7C9EFF" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <div className="text-2xl font-bold">$0.28</div>
                <div className="text-xs text-gray-500">avg per run</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Latency</h3>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={latencyData}>
                  <Line type="monotone" dataKey="latency" stroke="#7C9EFF" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <div className="text-2xl font-bold">1.4s</div>
                <div className="text-xs text-gray-500">avg latency</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mx-auto mb-10 max-w-4xl text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">Why AgentScope is different</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {[
              "Tracing alone shows what happened. AgentScope explains why.",
              "Built for AI debugging, not generic application monitoring.",
              "Combines run visibility, root-cause analysis, and cost insight in one workflow.",
            ].map((point) => (
              <div key={point} className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm text-gray-300">
                {point}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-12 text-center text-3xl font-bold md:text-4xl">Built for teams</h2>

          <div className="grid gap-6 md:grid-cols-2">
            {[
              {
                icon: Shield,
                title: "Organizations and projects",
                desc: "Organize your work by team and project",
              },
              {
                icon: Activity,
                title: "API key authentication",
                desc: "Secure access with API keys",
              },
              {
                icon: Sparkles,
                title: "Onboarding path to first trace",
                desc: "Signup includes organization + project context and guided setup",
              },
              {
                icon: TrendingDown,
                title: "Secure multi-tenant architecture",
                desc: "Your data is isolated and protected",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-6"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#7C9EFF]/20">
                  <item.icon className="h-5 w-5 text-[#7C9EFF]" />
                </div>
                <div className="flex-1">
                  <h3 className="mb-1 font-semibold">{item.title}</h3>
                  <p className="text-sm text-gray-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-28">
        <div className="mx-auto w-full max-w-[1368px] text-center">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] px-8 py-16">
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#7C9EFF]/14 to-[#7C9EFF]/6 blur-3xl" />
            <h2 className="mb-6 text-4xl font-bold md:text-6xl">Debug faster. Reduce cost. Ship more reliable AI.</h2>
            <p className="mx-auto mb-8 max-w-3xl text-xl text-gray-400">
              Understand failures, find root causes, and improve agent performance without slowing your team down.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href={isAuthenticated ? "/dashboard" : "/signup"}
                className="rounded-lg bg-[#7C9EFF] px-8 py-4 text-lg font-medium text-[#0B0F14] transition-colors hover:bg-[#A5B4FC]"
              >
                Start Free
              </Link>
              <Link
                href={isAuthenticated ? "/runs" : "/demo"}
                className="rounded-lg border border-white/20 px-8 py-4 text-lg font-medium transition-colors hover:bg-white/5"
              >
                Run Demo
              </Link>
            </div>
          </div>
        </div>
      </section>

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
                <li>
                  <Link href="/features" className="transition-colors hover:text-white">
                    Features
                  </Link>
                </li>
                <li>
                  <Link href="/pricing" className="transition-colors hover:text-white">
                    Pricing
                  </Link>
                </li>
                <li>
                  <Link href="/docs" className="transition-colors hover:text-white">
                    Docs
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <Link href="/docs" className="transition-colors hover:text-white">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="/demo" className="transition-colors hover:text-white">
                    Blog
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Legal</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <Link href="/legal/privacy" className="transition-colors hover:text-white">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href="/legal/terms" className="transition-colors hover:text-white">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href="/docs/security" className="transition-colors hover:text-white">
                    Security
                  </Link>
                </li>
                <li>
                  <Link href="/status" className="transition-colors hover:text-white">
                    Status
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/5 pt-8 text-sm text-gray-400">
            <p>© 2026 AgentScope. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-white"
              >
                <Github className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
