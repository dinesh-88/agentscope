import { MarketingShell } from "@/components/marketing-shell";

export default async function SecurityPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Security</h1>
          <ul className="mt-6 space-y-3 text-sm text-gray-300">
            <li>Data is isolated by organization and project boundaries.</li>
            <li>API keys are scoped and revocable.</li>
            <li>All traffic is encrypted in transit.</li>
            <li>Audit and access controls are available at project level.</li>
          </ul>
        </div>
      </main>
    </MarketingShell>
  );
}
