import { MarketingShell } from "@/components/marketing-shell";

export default async function TermsPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Terms of Service</h1>
          <p className="mt-4 text-sm text-gray-300">By using AgentScope, you agree to use the service in accordance with applicable laws and your organization policies.</p>
        </div>
      </main>
    </MarketingShell>
  );
}
