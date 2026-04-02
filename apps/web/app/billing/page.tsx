"use client";

import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createBillingCheckout, getCurrentUser, getProjectBilling, type BillingOverview } from "@/lib/api";

export default function BillingPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBilling() {
    setLoading(true);
    setError(null);
    try {
      const me = await getCurrentUser();
      const defaultProjectId = me.onboarding.default_project_id;
      setProjectId(defaultProjectId);
      if (!defaultProjectId) {
        setBilling(null);
        return;
      }
      const result = await getProjectBilling(defaultProjectId);
      setBilling(result);
    } catch {
      setError("Failed to load billing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBilling();
  }, []);

  const usageText = useMemo(() => {
    if (!billing) return "0 / 1,000 runs used";
    return `${billing.runs_used.toLocaleString()} / ${billing.run_limit.toLocaleString()} runs used`;
  }, [billing]);

  const planText = billing?.plan ?? "free";
  const statusText = billing?.status ?? "active";
  const hasProjectContext = Boolean(projectId);

  async function handleUpgrade() {
    if (!projectId) return;
    setUpgrading(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const session = await createBillingCheckout(projectId, {
        success_url: `${origin}/billing?checkout=success`,
        cancel_url: `${origin}/billing?checkout=cancel`,
      });
      window.location.href = session.checkout_url;
    } catch {
      setError("Failed to start checkout.");
      setUpgrading(false);
    }
  }

  return (
    <AppShell activePath="/billing">
      <section className="space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-950 dark:text-neutral-100">Billing</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">Manage plan and monthly run usage.</p>
        </div>

        {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <Card className="border border-black/5 bg-white/85 py-0 shadow-sm dark:border-white/10 dark:bg-neutral-900/80">
          <CardHeader>
            <CardTitle className="text-neutral-900 dark:text-neutral-100">Current Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 py-5">
            {loading ? <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading billing...</p> : null}
            {!loading ? (
              <>
                <div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">Plan</p>
                  <p className="text-lg font-semibold text-neutral-900 uppercase dark:text-neutral-100">{planText}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">Usage</p>
                  <p className="text-base font-medium text-neutral-900 dark:text-neutral-100">{usageText}</p>
                </div>
                <div>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">Status</p>
                  <p className="text-base font-medium text-neutral-900 dark:text-neutral-100">{statusText}</p>
                </div>
                {!hasProjectContext ? (
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">No default project is configured for this account yet.</p>
                ) : null}
                <Button onClick={handleUpgrade} disabled={!hasProjectContext || upgrading || planText === "pro"}>
                  {planText === "pro" ? "Pro Active" : upgrading ? "Redirecting..." : "Upgrade to Pro"}
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
