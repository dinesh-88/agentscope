import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export default async function DocsPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-[1368px]">
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

          <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Available SDK methods</h2>
            <p className="mt-2 text-sm text-gray-400">
              Public methods currently available in the Python and TypeScript SDKs.
            </p>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <article className="rounded-xl border border-white/10 bg-black/20 p-5">
                <h3 className="text-lg font-semibold text-white">Python SDK</h3>
                <p className="mt-1 text-xs text-gray-400">Package: <code className="rounded bg-black/30 px-1.5 py-0.5">agentscope</code></p>
                <ul className="mt-4 space-y-2 text-sm text-gray-300">
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">init(telemetry=None)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">observe_run(...)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">observe_span(...)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">auto_trace(providers=None)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">auto_instrument(providers=None, ...)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">coding_agent_run(agent_name=&quot;coding_agent&quot;)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">instrument_coding_agent(fn)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">read_file(path, encoding=&quot;utf-8&quot;)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">write_file(path, content, encoding=&quot;utf-8&quot;)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">run_command(command, ...)</code></li>
                </ul>
                <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-gray-300">
                  <p className="font-medium text-white">Trace facade</p>
                  <p className="mt-2"><code className="rounded bg-black/30 px-1.5 py-0.5">trace.auto(...)</code></p>
                  <p><code className="rounded bg-black/30 px-1.5 py-0.5">trace.log(message, ...)</code></p>
                  <p><code className="rounded bg-black/30 px-1.5 py-0.5">trace.update_span(span_id, data)</code></p>
                </div>
              </article>

              <article className="rounded-xl border border-white/10 bg-black/20 p-5">
                <h3 className="text-lg font-semibold text-white">TypeScript SDK</h3>
                <p className="mt-1 text-xs text-gray-400">Package: <code className="rounded bg-black/30 px-1.5 py-0.5">@agentscope/sdk</code></p>
                <ul className="mt-4 space-y-2 text-sm text-gray-300">
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">observeRun(workflowName, fn, options?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">observeSpan(name, fn, options?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">addArtifact(kind, payload, spanId?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">updateSpan(spanId, data)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">autoTrace(providers?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">autoInstrument(providers?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">codingAgentRun(fn, options?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">instrumentCodingAgent(fn)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">readFile(filePath, encoding?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">writeFile(filePath, content, encoding?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">runCommand(command, options?)</code></li>
                  <li><code className="rounded bg-black/30 px-1.5 py-0.5">flush()</code></li>
                </ul>
                <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3 text-sm text-gray-300">
                  <p className="font-medium text-white">Trace facade</p>
                  <p className="mt-2"><code className="rounded bg-black/30 px-1.5 py-0.5">trace.auto(...)</code></p>
                  <p><code className="rounded bg-black/30 px-1.5 py-0.5">trace.log(message, options?)</code></p>
                  <p><code className="rounded bg-black/30 px-1.5 py-0.5">trace.updateSpan(spanId, data)</code></p>
                </div>
              </article>
            </div>
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
