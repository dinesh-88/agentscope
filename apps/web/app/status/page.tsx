import { MarketingShell } from "@/components/marketing-shell";

export default async function StatusPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">System Status</h1>
          <p className="mt-3 text-sm text-emerald-300">All systems operational</p>
          <p className="mt-2 text-sm text-gray-400">Uptime target: 99.95%</p>
        </div>
      </main>
    </MarketingShell>
  );
}
