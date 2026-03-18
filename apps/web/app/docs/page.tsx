import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export default async function DocsPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Docs</h1>
          <p className="mt-3 text-gray-400">Quickstart to send your first trace.</p>

          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">3-step quickstart</h2>
            <ol className="mt-4 space-y-3 text-sm text-gray-300">
              <li>1. Install: <code className="rounded bg-black/30 px-2 py-0.5">pip install agentscope-sdk</code> or <code className="rounded bg-black/30 px-2 py-0.5">npm install @agentscope/sdk</code></li>
              <li>2. Set API key: <code className="rounded bg-black/30 px-2 py-0.5">export AGENTSCOPE_API_KEY=...</code></li>
              <li>3. Send first trace and confirm: <code className="rounded bg-black/30 px-2 py-0.5">trace received: run_...</code></li>
            </ol>
          </section>

          <div className="mt-8 flex flex-wrap gap-4 text-sm">
            <Link href="/docs/security" className="text-blue-400 hover:text-blue-300">Security</Link>
            <Link href="/status" className="text-blue-400 hover:text-blue-300">Status</Link>
            <Link href="/legal/privacy" className="text-blue-400 hover:text-blue-300">Privacy</Link>
            <Link href="/legal/terms" className="text-blue-400 hover:text-blue-300">Terms</Link>
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}
