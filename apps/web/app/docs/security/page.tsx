import { MarketingShell } from "@/components/marketing-shell";

export default async function SecurityPage() {
  return (
    <MarketingShell>
      <main className="px-6 py-16">
        <div className="mx-auto w-full max-w-4xl">
          <h1 className="text-4xl font-bold">Security</h1>

          <section className="mt-8 space-y-4 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Overview</h2>
            <p>AgentScope is designed with a focus on secure handling of AI observability data.</p>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Data Protection</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Encryption in transit using HTTPS</li>
              <li>Secure storage using managed databases</li>
              <li>Logical data isolation per project</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Access Control</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>API key authentication</li>
              <li>Role-based access (planned)</li>
              <li>Restricted internal access</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Infrastructure</h2>
            <ul className="list-disc space-y-1 pl-6">
              <li>Hosted on secure cloud platforms</li>
              <li>Regular updates and patching</li>
              <li>Monitoring for suspicious activity</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Sensitive Data</h2>
            <p>AgentScope may process:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Prompts</li>
              <li>Model outputs</li>
              <li>Tool inputs/outputs</li>
            </ul>

            <p>Users are responsible for avoiding:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Secrets</li>
              <li>Credentials</li>
              <li>Highly sensitive personal data</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Best Practices</h2>
            <p>We recommend:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>Masking sensitive data before sending</li>
              <li>Using test or synthetic data where possible</li>
              <li>Rotating API keys regularly</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Incident Response</h2>
            <p>If a security issue is detected:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>We investigate immediately</li>
              <li>Affected users are notified if required</li>
            </ul>
          </section>

          <section className="mt-8 space-y-3 text-sm text-gray-300">
            <h2 className="text-xl font-semibold text-white">Contact</h2>
            <p>
              <a className="text-blue-400 hover:text-blue-300" href="mailto:security@agentscope.dev">security@agentscope.dev</a>
            </p>
          </section>
        </div>
      </main>
    </MarketingShell>
  );
}
