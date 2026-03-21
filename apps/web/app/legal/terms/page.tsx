import { MarketingShell } from "@/components/marketing-shell";

export default async function TermsPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Terms of Service</h1>

          <section className="mt-8 space-y-4 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Overview</h2>
            <p>These Terms govern your use of AgentScope.</p>
            <p>By using the service, you agree to these terms.</p>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Use of Service</h2>
            <p>You may use AgentScope to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Monitor and analyze AI agent behavior</li>
              <li>Store and review trace data</li>
            </ul>

            <p>You agree not to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Use the service for illegal activities</li>
              <li>Abuse or overload the system</li>
              <li>Attempt unauthorized access</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Data Responsibility</h2>
            <p>You are responsible for:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>The data you send to AgentScope</li>
              <li>Ensuring you have rights to process that data</li>
            </ul>

            <p>You should not send:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Sensitive personal data unless properly handled</li>
              <li>Secrets or credentials in prompts or logs</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Availability</h2>
            <p>We aim to provide a reliable service but do not guarantee:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Uninterrupted availability</li>
              <li>Error-free operation</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Limitation of Liability</h2>
            <p>AgentScope is provided &quot;as is&quot;.</p>
            <p>We are not liable for:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Data loss</li>
              <li>Indirect damages</li>
              <li>Business interruption</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Termination</h2>
            <p>We may suspend or terminate access if:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Terms are violated</li>
              <li>Abuse is detected</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Changes</h2>
            <p>We may update these terms. Continued use implies acceptance.</p>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Contact</h2>
            <p>
              <a className="text-blue-400 hover:text-blue-300" href="mailto:contact@agentscope.dev">contact@agentscope.dev</a>
            </p>
          </section>
        </div>
      </main>
    </MarketingShell>
  );
}
