import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { MarketingShell } from "@/components/marketing-shell";

export default async function DemoPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8">
            <h1 className="text-4xl font-bold tracking-tight md:text-5xl">Run the demo in 60 seconds</h1>
            <p className="mt-3 max-w-3xl text-lg text-gray-400">
              AgentScope is observability only. Run the demo repo locally and watch traces stream in.
            </p>
          </div>

          <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-gray-900/70 to-gray-800/60 p-8">
            <ol className="grid gap-3 text-sm text-gray-300 md:grid-cols-4">
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">1. Copy your API key</li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">2. Clone the demo repo</li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">3. Run the demo locally</li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-4">4. Open traces in AgentScope</li>
            </ol>
            <div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-4">
              <pre className="overflow-x-auto text-xs text-gray-300">
                <code>{`pip install agentscope-sdk
export AGENTSCOPE_API_KEY=proj_live_xxx
git clone https://github.com/agentscope-dev/agentscope-demo-python
cd agentscope-demo-python
python main.py`}</code>
              </pre>
            </div>
          </section>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 font-medium transition-opacity hover:opacity-90"
            >
              Start Free and Observe Your Agent
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/runs" className="text-sm text-blue-400 hover:text-blue-300">
              Open runs
            </Link>
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}
