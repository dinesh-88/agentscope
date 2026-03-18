"use client";

import { FormEvent, useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createOrgInvite,
  getCurrentUser,
  getOrgMembers,
  removeOrgMember,
  type TeamMember,
} from "@/lib/api";

const roles = ["viewer", "developer", "admin"];

export default function TeamSettingsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("developer");

  async function reload(orgId: string) {
    const rows = await getOrgMembers(orgId);
    setMembers(rows);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const me = await getCurrentUser();
      const orgId = me.user.memberships[0]?.organization_id ?? null;
      if (!orgId || cancelled) return;
      setOrganizationId(orgId);
      await reload(orgId);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    await createOrgInvite(organizationId, { email, role });
    setEmail("");
    await reload(organizationId);
  }

  async function handleRemove(userId: string) {
    if (!organizationId) return;
    await removeOrgMember(organizationId, userId);
    await reload(organizationId);
  }

  return (
    <AppShell activePath="/settings">
      <section className="space-y-6 p-6 sm:p-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Team Collaboration</h1>
          <p className="text-sm text-gray-600">Invite members, assign roles, and manage organization access.</p>
        </div>

        <Card className="border border-black/8 shadow-none ring-0">
          <CardHeader>
            <CardTitle>Invite Member</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={handleInvite}>
              <input
                type="email"
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@company.com"
                required
              />
              <select className="rounded-md border px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <Button type="submit" className="sm:col-span-3" disabled={!organizationId}>
                Send Invite
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border border-black/8 shadow-none ring-0">
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {members.map((member) => (
                <div key={member.user_id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">{member.display_name ?? member.email}</p>
                    <p className="text-gray-600">
                      {member.email} · {member.role}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleRemove(member.user_id)}>
                    Remove
                  </Button>
                </div>
              ))}
              {members.length === 0 ? <p className="text-sm text-gray-600">No members found.</p> : null}
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
