"use client";

import axios from "axios";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cancelOrgInvite,
  createProjectInvite,
  getCurrentUser,
  getOrgMembers,
  getOrgPendingInvites,
  removeOrgMember,
  resendOrgInvite,
  updateOrgMemberRole,
  type InviteRecord,
  type TeamMember,
} from "@/lib/api";

const roles: Array<"admin" | "member"> = ["admin", "member"];

function getApiErrorMessage(error: unknown, fallback: string) {
  if (!axios.isAxiosError(error)) return fallback;
  const data = error.response?.data;
  if (data && typeof data === "string" && data.length > 0) return data;
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  if (typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

function isValidEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254 || normalized.includes(" ")) return false;
  const parts = normalized.split("@");
  if (parts.length !== 2) return false;
  if (!parts[0] || !parts[1]) return false;
  if (!parts[1].includes(".") || parts[1].startsWith(".") || parts[1].endsWith(".")) return false;
  return true;
}

export default function TeamSettingsPage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<InviteRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const adminCount = useMemo(() => members.filter((member) => member.role === "admin").length, [members]);

  const isCurrentUserLastAdmin = useMemo(() => {
    if (!currentUserId) return false;
    const current = members.find((member) => member.user_id === currentUserId);
    if (!current) return false;
    return current.role === "admin" && adminCount <= 1;
  }, [adminCount, currentUserId, members]);

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => {
      setToastMessage((current) => (current === message ? null : current));
    }, 2200);
  }

  async function reload(orgId: string, loadingMode: "initial" | "refresh" = "refresh") {
    setErrorMessage(null);
    if (loadingMode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [membersResponse, invitesResponse] = await Promise.all([
        getOrgMembers(orgId),
        getOrgPendingInvites(orgId),
      ]);
      setMembers(membersResponse);
      setPendingInvites(invitesResponse);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to load team data."));
    } finally {
      if (loadingMode === "initial") {
        setLoading(false);
      }
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const me = await getCurrentUser();
        if (cancelled) return;

        const membership = me.user.memberships[0] ?? null;
        const orgId = membership?.organization_id ?? null;
        setOrganizationId(orgId);
        setProjectId(me.onboarding.default_project_id ?? null);
        setCurrentUserId(me.user.id);

        const normalizedRole = membership?.role === "owner" ? "admin" : membership?.role;
        setIsAdmin(normalizedRole === "admin");

        if (!orgId) {
          setLoading(false);
          return;
        }

        await reload(orgId, "initial");
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(getApiErrorMessage(error, "Failed to load team settings."));
        setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);
    setErrorMessage(null);

    if (!organizationId || !projectId || !isAdmin) return;

    if (!isValidEmail(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }

    setInviteSubmitting(true);
    try {
      await createProjectInvite(projectId, { email: email.trim().toLowerCase(), role });
      setEmail("");
      setRole("member");
      await reload(organizationId);
      showToast("Invite sent.");
    } catch (error) {
      setInviteError(getApiErrorMessage(error, "Failed to send invite."));
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function handleRemove(userId: string) {
    if (!organizationId || !isAdmin) return;

    const target = members.find((member) => member.user_id === userId);
    if (!target) return;

    if (target.user_id === currentUserId && target.role === "admin" && adminCount <= 1) {
      setErrorMessage("Cannot remove the last admin.");
      return;
    }

    setErrorMessage(null);
    try {
      await removeOrgMember(organizationId, userId);
      await reload(organizationId);
      showToast("Member removed.");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to remove member."));
    }
  }

  async function handleRoleChange(userId: string, nextRole: "admin" | "member") {
    if (!organizationId || !isAdmin) return;

    const target = members.find((member) => member.user_id === userId);
    if (!target || target.role === nextRole) return;

    if (target.user_id === currentUserId && target.role === "admin" && nextRole === "member" && adminCount <= 1) {
      setErrorMessage("Cannot demote the last admin.");
      return;
    }

    setErrorMessage(null);
    try {
      await updateOrgMemberRole(organizationId, userId, nextRole);
      await reload(organizationId);
      showToast("Role updated.");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to update role."));
    }
  }

  async function handleResend(inviteId: string) {
    if (!organizationId || !isAdmin) return;

    setErrorMessage(null);
    try {
      await resendOrgInvite(organizationId, inviteId);
      await reload(organizationId);
      showToast("Invite resent.");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to resend invite."));
    }
  }

  async function handleCancel(inviteId: string) {
    if (!organizationId || !isAdmin) return;

    setErrorMessage(null);
    try {
      await cancelOrgInvite(organizationId, inviteId);
      await reload(organizationId);
      showToast("Invite canceled.");
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error, "Failed to cancel invite."));
    }
  }

  return (
    <AppShell activePath="/settings">
      <section className="space-y-6 p-6 sm:p-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Team Collaboration</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">Invite members, assign roles, and manage organization access.</p>
        </div>

        {errorMessage ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
        ) : null}

        <Card className="border border-black/8 shadow-none ring-0 dark:border-white/10 dark:bg-neutral-900/80">
          <CardHeader>
            <CardTitle>Invite Member</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={handleInvite}>
              <input
                type="email"
                className="rounded-md border px-3 py-2 text-sm sm:col-span-2"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@company.com"
                required
                disabled={!isAdmin || !projectId || loading}
              />
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={role}
                onChange={(event) => setRole(event.target.value as "admin" | "member")}
                disabled={!isAdmin || loading}
              >
                {roles.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <Button
                type="submit"
                className="sm:col-span-3"
                disabled={!organizationId || !projectId || !isAdmin || loading || inviteSubmitting}
              >
                {inviteSubmitting ? "Sending..." : "Send Invite"}
              </Button>
            </form>
            {inviteError ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{inviteError}</p> : null}
            {!isAdmin ? (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Only admins can invite members.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border border-black/8 shadow-none ring-0 dark:border-white/10 dark:bg-neutral-900/80">
          <CardHeader>
            <CardTitle>Pending Invites</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{invite.email}</p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {invite.role} · pending · expires {new Date(invite.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleResend(invite.id)} disabled={!isAdmin || loading}>
                      Resend
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleCancel(invite.id)} disabled={!isAdmin || loading}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
              {pendingInvites.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">No pending invites.</p> : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-black/8 shadow-none ring-0 dark:border-white/10 dark:bg-neutral-900/80">
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {members.map((member) => {
                const isSelf = member.user_id === currentUserId;
                const isLastAdminSelf = isSelf && member.role === "admin" && isCurrentUserLastAdmin;
                return (
                  <div key={member.user_id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{member.display_name ?? member.email}</p>
                      <p className="text-gray-600 dark:text-gray-300">
                        {member.email} · {member.membership_state}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-md border px-2 py-1 text-sm"
                        value={member.role as "admin" | "member"}
                        onChange={(event) => handleRoleChange(member.user_id, event.target.value as "admin" | "member")}
                        disabled={!isAdmin || isLastAdminSelf || loading}
                      >
                        {roles.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRemove(member.user_id)}
                        disabled={!isAdmin || isLastAdminSelf || loading}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
              {members.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">No members found.</p> : null}
            </div>
            {refreshing ? <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Refreshing...</p> : null}
          </CardContent>
        </Card>
      </section>

      {toastMessage ? (
        <div className="fixed right-6 bottom-6 z-50 rounded-md bg-gray-900 px-3 py-2 text-sm text-white shadow-lg">
          {toastMessage}
        </div>
      ) : null}
    </AppShell>
  );
}
