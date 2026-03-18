import { MarketingShell } from "@/components/marketing-shell";

export default async function PrivacyPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Privacy Policy</h1>
          <p className="mt-4 text-sm text-gray-300">AgentScope stores telemetry required to visualize traces, root causes, and usage insights. Customer data remains scoped to workspace boundaries.</p>
        </div>
      </main>
    </MarketingShell>
  );
}
