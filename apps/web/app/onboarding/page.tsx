import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { OnboardingApiKey } from "@/components/onboarding-api-key";
import { OnboardingFirstRun } from "@/components/onboarding-first-run";
import { OnboardingSdkTabs } from "@/components/onboarding-sdk-tabs";
import { OnboardingWelcome } from "@/components/onboarding-welcome";
import { getCurrentUser, getRuns } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const me = await getCurrentUser();
  if (!me) {
    redirect("/login");
  }

  const runs = await getRuns();
  const firstRun = runs[0] ?? null;

  if (me.onboarding.has_first_run && firstRun) {
    redirect(`/runs/${firstRun.id}`);
  }

  return (
    <AppShell activePath="/onboarding">
      <section className="space-y-6 p-6 sm:p-8">
        <OnboardingWelcome name={me.user.display_name} projectId={me.onboarding.default_project_id} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-6">
            <OnboardingApiKey apiKey={me.onboarding.generated_api_key} />
            <OnboardingFirstRun hasFirstRun={me.onboarding.has_first_run} firstRunId={firstRun?.id} />
          </div>
          <OnboardingSdkTabs apiKey={me.onboarding.generated_api_key} />
        </div>
      </section>
    </AppShell>
  );
}
