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
    <section className="min-h-screen bg-gradient-to-b from-[#0A1020] via-[#0B1324] to-[#0A0F1D] px-4 py-6 text-white md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
          <button type="button" className="mb-4 inline-flex items-center gap-2 text-sm text-gray-300">
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">agentscope-multi-agent-demo</h1>
            <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-300">FAILED</span>
          </div>

          <p className="mt-3 truncate rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">● Failure caused by invalid tool output injected into context</p>

          <p className="mt-3 text-xs text-gray-400">72.6s • 325 tokens • $0.0000 • gpt-4.1-mini</p>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
          <h2 className="mb-3 text-sm font-medium text-gray-200">Timeline Graph</h2>
          <div className="overflow-x-auto">
            <svg viewBox="0 0 980 240" className="h-[220px] w-full min-w-[760px]" role="img" aria-label="Latency over time graph">
              <line x1="80" y1="20" x2="80" y2="190" stroke="rgba(148,163,184,0.4)" strokeWidth="1" />
              <line x1="80" y1="190" x2="920" y2="190" stroke="rgba(148,163,184,0.4)" strokeWidth="1" />

              <path d="M120 155 L340 82 L560 110 L760 134" fill="none" stroke="rgba(125,211,252,0.7)" strokeWidth="2" />

              <circle cx="120" cy="155" r="6" fill="#60A5FA" />
              <rect x="334" y="76" width="12" height="12" fill="#FBBF24" />
              <polygon points="560,100 552,114 568,114" fill="#F59E0B" />
              <circle cx="760" cy="134" r="7" fill="#EF4444" />

              <circle cx="120" cy="155" r="12" fill="none" stroke="rgba(96,165,250,0.45)" strokeWidth="2" />
              <rect x="328" y="70" width="24" height="24" fill="none" stroke="rgba(251,191,36,0.45)" strokeWidth="2" />
              <circle cx="760" cy="134" r="13" fill="none" stroke="rgba(239,68,68,0.45)" strokeWidth="2" />

              <text x="16" y="104" fill="#94A3B8" fontSize="12">latency</text>
              <text x="488" y="226" fill="#94A3B8" fontSize="12">time</text>

              <text x="104" y="34" fill="#E2E8F0" fontSize="13" fontWeight="600">● LLM Call</text>
              <text x="104" y="51" fill="#CBD5E1" fontSize="12">router</text>
              <text x="104" y="68" fill="#CBD5E1" fontSize="12">14.2s</text>

              <text x="292" y="34" fill="#E2E8F0" fontSize="13" fontWeight="600">■ Tool Call</text>
              <text x="292" y="51" fill="#CBD5E1" fontSize="12">get_order_status</text>
              <text x="292" y="68" fill="#CBD5E1" fontSize="12">+1200 tokens</text>

              <text x="530" y="34" fill="#E2E8F0" fontSize="13" fontWeight="600">⚠ Context change</text>

              <text x="700" y="34" fill="#FCA5A5" fontSize="13" fontWeight="600">🔴 FAILED</text>
              <text x="700" y="51" fill="#FECACA" fontSize="12">llm_call</text>
              <text x="700" y="68" fill="#FECACA" fontSize="12">9.8s</text>
            </svg>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-[65fr_35fr]">
          <main className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-300">Execution Story</h2>

            <div className="space-y-0">
              <div className="py-1.5">
                <p className="text-sm font-medium text-white">LLM • router</p>
                <p className="text-xs text-gray-400">14.2s</p>
              </div>

              <div className="ml-1 h-5 border-l border-white/20" />

              <div className="py-1.5">
                <p className="text-sm font-medium text-white">Tool • get_order_status</p>
                <p className="text-xs text-gray-400">32s • +1200 tokens</p>
              </div>

              <div className="ml-1 h-5 border-l border-white/20" />

              <div className="py-1.5">
                <p className="text-sm font-medium text-yellow-300">⚠ Tool output injected</p>
                <p className="text-xs text-gray-400">+ Context grew (+1200 tokens)</p>
              </div>

              <div className="ml-1 h-5 border-l border-white/20" />

              <div className="py-1.5">
                <p className="text-sm font-semibold text-red-300">🔴 FAILED STEP</p>
                <p className="text-sm font-medium text-white">LLM • llm_call</p>
                <p className="text-xs text-gray-400">5.8s • 118 tokens</p>
              </div>
            </div>
          </main>

          <aside className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 md:sticky md:top-4 md:self-start">
            <p className="mb-4 text-sm font-semibold text-red-200">[ Invalid JSON from tool_call ]</p>

            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-100/80">CAUSE</p>
              <p className="text-sm text-red-50">Tool output introduced invalid data</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-100/80">FIX</p>
              <p className="text-sm text-red-50">• Validate tool output</p>
              <p className="text-sm text-red-50">• Add retry with schema enforcement</p>
            </div>
          </aside>
        </section>
      </div>
    </section>
  );
}
