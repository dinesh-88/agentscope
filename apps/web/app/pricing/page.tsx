import Link from "next/link";

import { MarketingShell } from "@/components/marketing-shell";

export default async function PricingPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Pricing</h1>
          <p className="mt-3 text-gray-400">Simple pricing for teams shipping AI agents in production.</p>

          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <h2 className="text-xl font-semibold">Free</h2>
              <p className="mt-2 text-sm text-gray-400">For evaluation and first integration.</p>
              <p className="mt-4 text-3xl font-bold">$0</p>
              <p className="mt-1 text-sm text-gray-500">Up to 1,000 traces/month</p>
            </section>
            <section className="rounded-2xl border border-blue-400/30 bg-blue-500/10 p-6">
              <h2 className="text-xl font-semibold">Pro</h2>
              <p className="mt-2 text-sm text-gray-300">For active production teams.</p>
              <p className="mt-4 text-3xl font-bold">Contact sales</p>
              <p className="mt-1 text-sm text-gray-400">Higher limits, team controls, and support</p>
            </section>
          </div>

          <div className="mt-8">
            <Link href="/signup" className="inline-flex rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 font-medium">
              Start Free and Send First Trace
            </Link>
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}
