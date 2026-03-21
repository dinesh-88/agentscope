import { MarketingShell } from "@/components/marketing-shell";

export default async function PrivacyPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Privacy Policy</h1>

          <section className="mt-8 space-y-4 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Overview</h2>
            <p>
              AgentScope is an AI observability platform that helps developers analyze and debug AI agents. This Privacy
              Policy explains what data we collect, how we use it, and how we protect it.
            </p>
          </section>

          <section className="mt-8 space-y-4 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Data We Collect</h2>
            <h3 className="text-base font-medium text-white">1. Account Information</h3>
            <ul className="list-disc space-y-1 pl-6">
              <li>Email address</li>
              <li>Name (if provided)</li>
            </ul>

            <h3 className="text-base font-medium text-white">2. Usage Data</h3>
            <ul className="list-disc space-y-1 pl-6">
              <li>API requests</li>
              <li>Application logs</li>
              <li>Feature usage metrics</li>
            </ul>

            <h3 className="text-base font-medium text-white">3. Trace Data</h3>
            <ul className="list-disc space-y-1 pl-6">
              <li>Run metadata (timestamps, status)</li>
              <li>Span data (LLM calls, tool usage)</li>
              <li>Artifacts (prompts, responses, tool inputs/outputs)</li>
            </ul>

            <p>
              <span className="font-medium text-white">Note:</span> Trace data may include user-provided content depending
              on how AgentScope is used.
            </p>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">How We Use Data</h2>
            <p>We use collected data to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Provide and operate the service</li>
              <li>Improve performance and reliability</li>
              <li>Generate insights and analytics</li>
              <li>Debug issues</li>
            </ul>
            <p>We do not use your data to train general-purpose models.</p>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Data Storage</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Data is stored in secure cloud infrastructure</li>
              <li>Data is logically isolated per project and organization</li>
              <li>Access is restricted to authorized systems and personnel</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Data Retention</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Data is retained as long as your account is active</li>
              <li>You may request deletion of your data at any time</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Data Sharing</h2>
            <p>We do not sell your data.</p>
            <p>We may share data with:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Infrastructure providers (hosting, database)</li>
              <li>Legal authorities if required by law</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Security</h2>
            <p>We implement:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Encryption in transit (HTTPS)</li>
              <li>Access controls</li>
              <li>Monitoring and logging</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Your Rights</h2>
            <p>You can:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Request access to your data</li>
              <li>Request deletion of your data</li>
              <li>Contact us for privacy concerns</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Contact</h2>
            <p>
              For privacy-related questions: <a className="text-blue-400 hover:text-blue-300" href="mailto:contact@agentscope.dev">contact@agentscope.dev</a>
            </p>
          </section>
        </div>
      </main>
    </MarketingShell>
  );
}
