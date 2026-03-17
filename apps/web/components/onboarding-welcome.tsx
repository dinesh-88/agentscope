type OnboardingWelcomeProps = {
  name?: string | null;
  projectId?: string | null;
};

export function OnboardingWelcome({ name, projectId }: OnboardingWelcomeProps) {
  return (
    <section className="rounded-3xl border border-black/8 bg-white p-6 shadow-none">
      <div className="text-xs uppercase tracking-[0.24em] text-neutral-500">Welcome</div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950">
        {name ? `Welcome, ${name}` : "Welcome to AgentScope"}
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-neutral-600">
        Your default workspace is ready. Use the generated API key below to send your first trace, then AgentScope will redirect you
        straight into the first captured run.
      </p>
      {projectId ? <p className="mt-3 text-xs text-neutral-500">Default project: {projectId}</p> : null}
    </section>
  );
}
