"use client";

import { ArrowLeft } from "lucide-react";

import { type Artifact, type Run, type RunInsight, type RunRootCause, type Span } from "@/lib/api";

export function RunDetailView({
  run,
  spans,
  artifacts,
  insights,
  rootCause,
}: {
  run: Run;
  spans: Span[];
  artifacts: Artifact[];
  insights: RunInsight[];
  rootCause: RunRootCause | null;
}) {
  void run;
  void spans;
  void artifacts;
  void insights;
  void rootCause;

  return (
    <section className="min-h-screen bg-[#0B0F1A] text-white">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-8">
        {/* HEADER */}
        <header className="space-y-3">
          <button className="flex items-center gap-2 text-sm text-gray-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">agentscope-multi-agent-demo</h1>
            <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-400">FAILED</span>
          </div>

          <p className="text-sm text-red-300">● Failure caused by invalid tool output injected into context</p>

          <p className="text-xs text-gray-500">72.6s • 325 tokens • $0.0000 • gpt-4.1-mini</p>
        </header>

        {/* GRAPH */}
        <section className="space-y-2">
          <h2 className="text-sm text-gray-400">Execution Timeline</h2>

          <div className="rounded-xl border border-white/5 bg-[#0F1629] p-4">
            <svg viewBox="0 0 800 200" className="h-[180px] w-full">
              {/* line */}
              <path d="M80 150 L240 90 L420 110 L650 130" fill="none" stroke="#60A5FA" strokeWidth="2" />

              {/* markers */}
              <circle cx="80" cy="150" r="5" fill="#60A5FA" />
              <rect x="235" y="85" width="10" height="10" fill="#FBBF24" />
              <circle cx="650" cy="130" r="6" fill="#EF4444" />

              {/* labels */}
              <text x="60" y="175" fill="#94A3B8" fontSize="11">
                LLM
              </text>
              <text x="230" y="175" fill="#94A3B8" fontSize="11">
                Tool
              </text>
              <text x="630" y="175" fill="#FCA5A5" fontSize="11">
                Failure
              </text>
            </svg>
          </div>
        </section>

        {/* MAIN */}
        <section className="grid grid-cols-1 gap-8 md:grid-cols-[2fr_1fr]">
          {/* STORY */}
          <div className="relative space-y-6 pl-6">
            {/* vertical line */}
            <div className="absolute bottom-0 left-2 top-0 w-px bg-white/10" />

            {/* STEP */}
            <div className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-blue-400" />
              <div>
                <p className="text-sm font-medium">LLM • router</p>
                <p className="text-xs text-gray-500">14.2s</p>
              </div>
            </div>

            {/* STEP */}
            <div className="flex gap-3">
              <span className="mt-2 h-2 w-2 bg-yellow-400" />
              <div>
                <p className="text-sm font-medium">Tool • get_order_status</p>
                <p className="text-xs text-gray-500">32s • +1200 tokens</p>
              </div>
            </div>

            {/* CHANGE */}
            <div className="flex gap-3">
              <span className="mt-1 text-yellow-400">⚠</span>
              <div>
                <p className="text-sm text-yellow-300">Tool output injected</p>
                <p className="text-xs text-gray-500">+ Context grew (+1200 tokens)</p>
              </div>
            </div>

            {/* FAILURE */}
            <div className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-red-500" />
              <div>
                <p className="text-sm font-semibold text-red-400">FAILED STEP</p>
                <p className="text-sm font-medium">LLM • llm_call</p>
                <p className="text-xs text-gray-500">5.8s • 118 tokens</p>
              </div>
            </div>
          </div>

          {/* INSIGHT */}
          <div className="sticky top-6 h-fit space-y-4 rounded-xl border border-white/10 bg-[#0F1629] p-5">
            <p className="font-semibold text-red-300">Invalid JSON from tool_call</p>

            <div>
              <p className="text-xs uppercase text-gray-400">Cause</p>
              <p className="text-sm text-gray-200">Tool output introduced invalid data</p>
            </div>

            <div>
              <p className="text-xs uppercase text-gray-400">Fix</p>
              <p className="text-sm text-gray-200">• Validate tool output</p>
              <p className="text-sm text-gray-200">• Add retry with schema</p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
