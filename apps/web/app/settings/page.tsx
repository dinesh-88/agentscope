import Link from "next/link";
import { Building2, KeyRound, ShieldCheck, Users } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/server-api";

export default async function SettingsPage() {
  const me = await getCurrentUser();
  const canManageProject = me?.user.permissions.includes("project:manage") ?? false;

  return (
    <AppShell activePath="/settings">
      <section className="space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Settings</h1>
          <p className="text-sm text-neutral-600">Manage workspace security and team access in one place.</p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                Authentication
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-4 text-sm text-neutral-700">
              <div className="flex items-center justify-between rounded-lg border border-black/8 bg-white p-3">
                <span className="inline-flex items-center gap-2"><KeyRound className="size-4" /> Session auth</span>
                <span className="font-medium">Enabled</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-black/8 bg-white p-3">
                <span className="inline-flex items-center gap-2"><Building2 className="size-4" /> OIDC SSO</span>
                <span className="font-medium">Available</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-black/5 bg-white/85 py-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4 text-blue-600" />
                Team Collaboration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-4 text-sm text-neutral-700">
              <p>Invite members, adjust roles, and maintain secure organization access.</p>
              <div className="rounded-lg border border-black/8 bg-white p-3">
                <p className="text-xs text-neutral-500">Project access</p>
                <p className="font-medium text-neutral-900">{canManageProject ? "Manage" : "Read only"}</p>
              </div>
              <Link href="/settings/team" className="inline-flex rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white">
                Open team settings
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
