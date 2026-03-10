import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <AppShell activePath="/settings">
      <section className="p-6 sm:p-8">
        <div className="mb-8">
          <h1 className="mb-2 text-gray-900">Settings</h1>
          <p className="text-gray-600">Configuration surface for the AgentScope UI environment.</p>
        </div>

        <Card className="max-w-2xl border border-black/8 shadow-none ring-0">
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-600">
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span>Frontend</span>
              <span className="font-medium text-gray-900">Next.js</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span>API Auth</span>
              <span className="font-medium text-gray-900">JWT session cookie</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span>Design system</span>
              <span className="font-medium text-gray-900">Figma-aligned</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
