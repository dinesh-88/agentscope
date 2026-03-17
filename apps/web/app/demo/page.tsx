import { AppShell } from "@/components/app-shell";
import { DemoScenarios } from "@/components/demo-scenarios";
import { getDemoScenarios } from "@/lib/server-api";

export default async function DemoPage() {
  const scenarios = await getDemoScenarios();

  return (
    <AppShell activePath="/demo">
      <section className="space-y-6 p-6 sm:p-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-950">Demo Mode</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">
            Replay pre-recorded traces into AgentScope without consuming live model tokens.
          </p>
        </div>
        <DemoScenarios scenarios={scenarios} />
      </section>
    </AppShell>
  );
}
