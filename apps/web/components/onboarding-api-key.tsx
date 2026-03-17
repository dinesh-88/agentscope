"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type OnboardingApiKeyProps = {
  apiKey: string | null;
};

export function OnboardingApiKey({ apiKey }: OnboardingApiKeyProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
      <div className="text-xs uppercase tracking-[0.24em] text-emerald-700">API Key</div>
      <p className="mt-3 break-all font-mono text-sm text-emerald-950">{apiKey ?? "No bootstrap key is available for this session."}</p>
      <Button className="mt-4" disabled={!apiKey} onClick={copy} type="button">
        {copied ? "Copied" : "Copy API Key"}
      </Button>
    </section>
  );
}
