import { type Run } from "@/lib/api";

const VERSION_PATTERN = /\b(v(?:ersion)?\s*\d+(?:\.\d+)*)\b/i;

export function parseRunVersion(run: Pick<Run, "workflow_name" | "agent_name">): string | null {
  const candidates = [run.workflow_name, run.agent_name];
  for (const value of candidates) {
    const match = value.match(VERSION_PATTERN);
    if (match?.[1]) {
      return match[1].toLowerCase().replace("version", "v").replace(/\s+/g, "");
    }
  }
  return null;
}
