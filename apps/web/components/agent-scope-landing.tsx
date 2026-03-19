"use client";

import { useState } from "react";
import Link from "next/link";
import { mockTraceSpans } from "@/components/mock-trace-data";
import { TraceView } from "@/components/trace-view";
import {
  Activity,
  ArrowRight,
  Brain,
  Check,
  Copy,
  Github,
  Play,
  Shield,
  Sparkles,
  TestTube,
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
    <div className="min-h-screen bg-[#0B0F14] text-white">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#0B0F14]/80 backdrop-blur-lg">
        <div className="mx-auto flex w-full max-w-[1368px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500">
                <Activity className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-semibold">AgentScope</span>
            </Link>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-sm md:flex">
              <a href="#features" className="rounded-full px-3 py-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                Features
              </a>
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
                  className="rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
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
                  className="rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                >
                  Get Started Free
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>

      <section className="px-6 pt-20 pb-16">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mx-auto mb-16 max-w-4xl text-center">
            <h1 className="mb-6 bg-gradient-to-br from-white via-white to-gray-400 bg-clip-text text-5xl font-bold text-transparent md:text-7xl">
              Find why your AI agent failed in under 5 minutes.
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-xl text-gray-400">
              Trace every step, get root-cause explanations, and cut token cost with actionable fixes.
            </p>
            <div className="flex items-center justify-center gap-4">
              {isAuthenticated ? (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 font-medium transition-opacity hover:opacity-90"
                >
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <Link
                  href="/signup"
                  className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 font-medium transition-opacity hover:opacity-90"
                >
                  Start Free and Send First Trace
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              <Link
                href="/demo"
                className="flex items-center gap-2 rounded-lg border border-white/20 px-6 py-3 font-medium transition-colors hover:bg-white/5"
              >
                <Play className="h-4 w-4" />
                Watch 90-Second Product Tour
              </Link>
            </div>
            {!isAuthenticated ? <p className="mt-3 text-sm text-gray-500">No credit card. First trace in about 3 minutes.</p> : null}
          </div>

        </div>
      </section>

      <section className="bg-gradient-to-b from-transparent to-purple-500/5 px-6 pt-10 pb-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-16 text-center text-3xl font-bold md:text-4xl">
            AI agents are powerful — but hard to debug
          </h2>

          <div className="grid gap-12 md:grid-cols-2">
            <div className="space-y-6">
              <h3 className="mb-6 text-xl font-semibold text-red-400">Common challenges</h3>
              {["Why did my agent fail?", "Which prompt caused this issue?", "Why is cost increasing?", "Which tool broke?"].map((problem) => (
                <div key={problem} className="flex items-start gap-3">
                  <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-500/20">
                    <span className="text-sm text-red-400">✕</span>
                  </div>
                  <p className="text-lg text-gray-300">{problem}</p>
                </div>
              ))}
            </div>

            <div className="space-y-6">
              <h3 className="mb-6 text-xl font-semibold text-green-400">How AgentScope helps</h3>
              {[
                "Full run tracing across your agent",
                "Root cause analysis for failures",
                "Prompt, response, and tool visibility",
                "Cost and latency tracking",
              ].map((solution) => (
                <div key={solution} className="flex items-start gap-3">
                  <div className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-green-500/30 bg-green-500/20">
                    <Check className="h-4 w-4 text-green-400" />
                  </div>
                  <p className="text-lg text-gray-300">{solution}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-16 text-center text-3xl font-bold md:text-4xl">
            Everything you need to understand your agents
          </h2>

          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/20">
                <Activity className="h-6 w-6 text-purple-400" />
              </div>
              <h3 className="mb-3 text-xl font-semibold">Run Tracing</h3>
              <p className="text-gray-400">
                Visualize every step of your agent with spans, tools, and LLM calls in a clear timeline.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/20">
                <Brain className="h-6 w-6 text-blue-400" />
              </div>
              <h3 className="mb-3 text-xl font-semibold">Root Cause Analysis</h3>
              <p className="text-gray-400">
                Automatically detect why runs fail and pinpoint the exact step that broke.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/20">
                <Zap className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="mb-3 text-xl font-semibold">Optimization Insights</h3>
              <p className="text-gray-400">
                Get suggestions to improve prompts, reduce latency, and lower cost.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-8">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-orange-500/20">
                <TestTube className="h-6 w-6 text-orange-400" />
              </div>
              <h3 className="mb-3 text-xl font-semibold">Sandbox Workflows</h3>
              <p className="text-gray-400">
                Test and iterate on agent workflows safely before deploying to production.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="demo" className="bg-gradient-to-b from-blue-500/5 to-transparent px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">From failure to insight in seconds</h2>
            <p className="text-lg text-gray-400">
              Quickly move from a broken run to a clear explanation and actionable fix.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-3">
              <TraceView spans={mockTraceSpans} title="Failed Run #1247" />
            </div>

            <div className="overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50">
              <div className="border-b border-blue-500/30 bg-blue-500/10 px-4 py-3">
                <span className="text-sm font-medium text-blue-400">Root Cause Analysis</span>
              </div>
              <div className="p-4">
                <h4 className="mb-2 font-semibold">Likely cause:</h4>
                <p className="mb-4 text-sm text-gray-400">
                  External API endpoint timeout. This endpoint has a 94% failure rate in the last hour.
                </p>
                <h4 className="mb-2 font-semibold">Suggested fix:</h4>
                <div className="rounded border border-green-500/30 bg-green-500/10 p-3">
                  <p className="font-mono text-xs text-green-400">
                    Increase timeout to 10s or add retry logic with exponential backoff
                  </p>
                </div>
                <div className="mt-4 border-t border-white/10 pt-4">
                  <Link href="/demo" className="text-sm text-blue-400 hover:text-blue-300">
                    View similar failures -&gt;
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="docs" className="px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <h2 className="mb-4 text-center text-3xl font-bold md:text-4xl">Send your first trace in 3 steps</h2>
          <p className="mb-12 text-center text-gray-400">Install SDK, add API key, and verify trace delivery.</p>

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
                  <span className="text-purple-400">import</span> os
                  {"\n"}
                  <span className="text-purple-400">import</span> agentscope
                  {"\n\n"}os.environ[<span className="text-green-400">{`"AGENTSCOPE_API_KEY"`}</span>] = os.getenv(
                  <span className="text-green-400">{`"AGENTSCOPE_API_KEY"`}</span>, <span className="text-green-400">{`""`}</span>)
                  {"\n"}agentscope.auto_instrument()
                  {"\n"}<span className="text-blue-400">print</span>(
                  <span className="text-green-400">{`"trace received: run_01H..."`}</span>)
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
                  <span className="text-purple-400">import</span> {"{ AgentScope }"} <span className="text-purple-400">from</span> <span className="text-green-400">{"'@agentscope/sdk'"}</span>;
                  {"\n"}<span className="text-purple-400">new</span> AgentScope({"{"} apiKey: process.env.AGENTSCOPE_API_KEY {"}"});
                  {"\n"}console.log(<span className="text-green-400">{`"trace received: run_01H..."`}</span>);
                </pre>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 border-t border-white/10 bg-gray-800/30 px-4 py-3 text-sm">
              <Link href="/signup" className="text-blue-400 transition-colors hover:text-blue-300">
                Start Free and Send First Trace
              </Link>
              <Link href="/demo" className="text-gray-300 transition-colors hover:text-white">
                Run sample repo in 2 minutes
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="bg-gradient-to-b from-purple-500/5 to-transparent px-6 py-20">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold md:text-4xl">Control your cost. Improve performance.</h2>
            <p className="text-lg text-gray-400">
              Track token usage, latency, and cost across every run and model.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Token Usage</h3>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={tokenUsageData}>
                  <defs>
                    <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="tokens" stroke="#a855f7" fill="url(#tokenGradient)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <div className="text-2xl font-bold">987K</div>
                <div className="text-xs text-gray-500">tokens this week</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Cost per Run</h3>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={costData}>
                  <Bar dataKey="cost" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4">
                <div className="text-2xl font-bold">$0.28</div>
                <div className="text-xs text-gray-500">avg per run</div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-6">
              <h3 className="mb-4 text-sm font-semibold text-gray-400">Latency Trends</h3>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={latencyData}>
                  <Line type="monotone" dataKey="latency" stroke="#10b981" strokeWidth={2} dot={false} />
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
                className="flex items-start gap-4 rounded-xl border border-white/10 bg-gradient-to-br from-gray-900/50 to-gray-800/50 p-6"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-purple-500/20">
                  <item.icon className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="font-semibold">{item.title}</h3>
                  </div>
                  <p className="text-sm text-gray-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-32">
        <div className="mx-auto w-full max-w-[1368px] text-center">
          <div className="relative">
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-purple-500/20 to-blue-500/20 blur-3xl" />
            <h2 className="mb-6 text-4xl font-bold md:text-6xl">Start debugging your AI agents today</h2>
            <p className="mb-8 text-xl text-gray-400">
              Understand failures, improve performance, and ship better AI faster.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link
                href={isAuthenticated ? "/dashboard" : "/signup"}
                className="rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-8 py-4 text-lg font-medium transition-opacity hover:opacity-90"
              >
                {isAuthenticated ? "Go to Dashboard" : "Start Free and Send First Trace"}
              </Link>
              <Link
                href="/demo"
                className="rounded-lg border border-white/20 px-8 py-4 text-lg font-medium transition-colors hover:bg-white/5"
              >
                Watch 90-Second Product Tour
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-12">
        <div className="mx-auto w-full max-w-[1368px]">
          <div className="mb-8 grid gap-8 md:grid-cols-4">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-blue-500">
                  <Activity className="h-5 w-5 text-white" />
                </div>
                <span className="font-semibold">AgentScope</span>
              </div>
              <p className="text-sm text-gray-400">Debug and optimize your AI agents with confidence.</p>
            </div>

            <div>
              <h4 className="mb-3 text-sm font-semibold">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li>
                  <a href="#features" className="transition-colors hover:text-white">
                    Features
                  </a>
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

          <div className="flex items-center justify-between border-t border-white/10 pt-8 text-sm text-gray-400">
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
