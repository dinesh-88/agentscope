"use client";

import { useState } from "react";

type OnboardingSdkTabsProps = {
  apiKey: string | null;
};

const EXAMPLES = {
  python: (apiKey: string | null) => `import os
import agentscope

os.environ["AGENTSCOPE_API_KEY"] = "${apiKey ?? "proj_live_xxx"}"
agentscope.auto_instrument()`,
  typescript: (apiKey: string | null) => `import { AgentScope } from "@agentscope/ts-sdk";

const client = new AgentScope({
  apiKey: "${apiKey ?? "proj_live_xxx"}",
});`,
};

export function OnboardingSdkTabs({ apiKey }: OnboardingSdkTabsProps) {
  const [sdk, setSdk] = useState<"python" | "typescript">("python");
  const code = sdk === "python" ? EXAMPLES.python(apiKey) : EXAMPLES.typescript(apiKey);

  return (
    <section className="rounded-3xl border border-black/8 bg-white p-6 shadow-none">
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
    </section>
  );
}
