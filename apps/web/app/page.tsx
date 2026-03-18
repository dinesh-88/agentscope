import { cookies } from "next/headers";

import { AgentScopeLanding } from "@/components/agent-scope-landing";
import { UI_SESSION_COOKIE_NAME } from "@/lib/api";

export default async function HomePage() {
  const token = (await cookies()).get(UI_SESSION_COOKIE_NAME)?.value;

  return <AgentScopeLanding isAuthenticated={Boolean(token)} />;
}
