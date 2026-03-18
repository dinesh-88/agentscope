type OnboardingWelcomeProps = {
  name?: string | null;
  projectId?: string | null;
  hasFirstRun?: boolean;
};

export function OnboardingWelcome({ name, projectId, hasFirstRun = false }: OnboardingWelcomeProps) {
  return (
    <section className="rounded-3xl border border-black/8 bg-white p-6 shadow-none">
      <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Welcome</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-100">
        {name ? `Welcome, ${name}` : "Welcome to AgentScope"}
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-neutral-600">
        Your default workspace is ready. Use the generated API key below to send your first trace, then AgentScope will redirect you
        straight into the first captured run.
      </p>
      <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="mb-2 text-xs uppercase tracking-[0.16em] text-neutral-500">Onboarding Progress</div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className={`h-full rounded-full bg-neutral-900 transition-all ${hasFirstRun ? "w-full" : "w-2/3"}`} />
        </div>
        <ol className="mt-3 grid gap-2 text-xs text-neutral-700 md:grid-cols-3">
          <li>Create account and workspace</li>
          <li>Install SDK and add API key</li>
          <li>{hasFirstRun ? "First trace received" : "Send first trace"}</li>
        </ol>
      </div>
      {projectId ? <p className="mt-3 text-xs text-neutral-500">Default project: {projectId}</p> : null}
    </section>
  );
}
