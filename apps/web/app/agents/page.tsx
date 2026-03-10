import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const agents = [
  { name: "Support Agent", role: "Customer support and case summarization", status: "Healthy" },
  { name: "Data Agent", role: "Extraction pipelines and schema normalization", status: "Healthy" },
  { name: "Code Agent", role: "Review, RCA, and patch generation", status: "Needs review" },
];

export default function AgentsPage() {
  return (
    <AppShell activePath="/agents">
      <section className="p-6 sm:p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-gray-900">Agents</h1>
          <p className="text-gray-600">Operational overview for the agents currently instrumented in the workspace.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent.name} className="border border-black/8 shadow-none ring-0">
              <CardHeader>
                <CardTitle>{agent.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600">{agent.role}</p>
                <div className="mt-4 inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {agent.status}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
