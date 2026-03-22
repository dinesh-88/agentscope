import type { Metadata } from "next";
import { Activity, Brain, TestTube, TrendingDown, Zap } from "lucide-react";

import { MarketingShell } from "@/components/marketing-shell";

const featureCards = [
  {
    title: "Run Tracing",
    description: "Visualize every step of your agent workflow, tools, and model calls in a single timeline.",
    icon: Activity,
  },
  {
    title: "Root Cause Analysis",
    description: "Pinpoint failure causes quickly so teams spend less time guessing and more time fixing.",
    icon: Brain,
  },
  {
    title: "Optimization Insights",
    description: "Get concrete recommendations to reduce latency, improve quality, and control token spend.",
    icon: Zap,
  },
  {
    title: "Fast Demo Quickstart",
    description: "Send your first trace in minutes with ready-to-run SDK quickstarts for Python and TypeScript.",
    icon: TestTube,
  },
  {
    title: "Team Workspaces",
    description: "Use organizations and project-level access to keep observability clean across teams.",
    icon: TrendingDown,
  },
];

export const metadata: Metadata = {
  title: "Features",
  description: "Explore AgentScope features for tracing, debugging, root-cause analysis, and AI agent optimization.",
  alternates: {
    canonical: "/features",
  },
};

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-5xl">
          <header className="max-w-3xl">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Features</h1>
            <p className="mt-3 text-lg text-gray-400">
              Everything you need to understand why AI agents fail, fix issues quickly, and ship reliable improvements.
            </p>
          </header>

          <section className="mt-10 grid gap-6 md:grid-cols-2">
            {featureCards.map((feature) => (
              <article key={feature.title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15">
                  <feature.icon className="h-5 w-5 text-blue-300" />
                </div>
                <h2 className="text-xl font-semibold">{feature.title}</h2>
                <p className="mt-2 text-sm leading-6 text-gray-300">{feature.description}</p>
              </article>
            ))}
          </section>
        </div>
      </main>
    </MarketingShell>
  );
}
