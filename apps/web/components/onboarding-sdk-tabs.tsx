"use client";

import { useState } from "react";
import Link from "next/link";

import { Copy } from "lucide-react";

type OnboardingSdkTabsProps = {
  apiKey: string | null;
};

const EXAMPLES = {
  python: (apiKey: string | null) => `# 1) Install SDK
pip install agentscope-sdk

# 2) Add your API key
export AGENTSCOPE_API_KEY=${apiKey ?? "proj_live_xxx"}

# 3) Clone and run the demo app
git clone https://github.com/agentscope-dev/agentscope-demo-python
cd agentscope-demo-python
python main.py`,
  typescript: (apiKey: string | null) => `# 1) Install SDK
npm install @agentscope/sdk

# 2) Add your API key
export AGENTSCOPE_API_KEY=${apiKey ?? "proj_live_xxx"}

# 3) Clone and run the demo app
git clone https://github.com/agentscope-dev/agentscope-demo-ts
cd agentscope-demo-ts
npm install
npm run dev`,
};

export function OnboardingSdkTabs({ apiKey }: OnboardingSdkTabsProps) {
  const [sdk, setSdk] = useState<"python" | "typescript">("python");
  const [copied, setCopied] = useState(false);
  const code = sdk === "python" ? EXAMPLES.python(apiKey) : EXAMPLES.typescript(apiKey);

  async function copyQuickstart() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-3xl border border-black/8 bg-white p-6 shadow-none">
      <div className="mb-4 text-xs uppercase tracking-[0.24em] text-neutral-500">Run The Demo In 60 Seconds</div>
      <div className="flex gap-2">
        <button
          className={`rounded-full px-4 py-2 text-sm ${sdk === "python" ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-700"}`}
          onClick={() => setSdk("python")}
          type="button"
        >
          Python
        </button>
        <button
          className={`rounded-full px-4 py-2 text-sm ${sdk === "typescript" ? "bg-neutral-950 text-white" : "bg-neutral-100 text-neutral-700"}`}
          onClick={() => setSdk("typescript")}
          type="button"
        >
          TypeScript
        </button>
      </div>
      <pre className="mt-4 overflow-auto rounded-2xl bg-neutral-950 p-4 text-sm leading-6 text-neutral-100">
        <code>{code}</code>
      </pre>
      <p className="mt-3 text-xs text-neutral-600">After the demo starts, open Runs to view spans, prompts, costs, and failures.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copyQuickstart}
          className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-sm text-white"
        >
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy Full Quickstart"}
        </button>
        <Link href="/runs" className="text-sm text-blue-600 underline underline-offset-2">
          Open runs
        </Link>
      </div>
    </section>
  );
}
