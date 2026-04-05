import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AgentScopeLanding } from "@/components/agent-scope-landing";
import { UI_SESSION_COOKIE_NAME } from "@/lib/api";

export const metadata: Metadata = {
  title: "AI Agent Debugging and LLM Observability | AgentScope",
  description:
    "Know exactly why your AI agent failed. Debug, trace, and optimize multi-agent workflows with real-time LLM observability and root cause insights.",
  keywords: [
    "AI agent debugging",
    "LLM observability",
    "multi-agent workflow monitoring",
    "agent trace",
    "root cause analysis for AI agents",
    "prompt debugging",
  ],
  openGraph: {
    title: "Know Exactly Why Your AI Agent Failed | AgentScope",
    description:
      "Debug, trace, and optimize multi-agent workflows with real-time LLM observability.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Know Exactly Why Your AI Agent Failed | AgentScope",
    description:
      "Debug, trace, and optimize multi-agent workflows with real-time LLM observability.",
  },
};

export default async function HomePage() {
  const token = (await cookies()).get(UI_SESSION_COOKIE_NAME)?.value;

  return <AgentScopeLanding isAuthenticated={Boolean(token)} />;
}
