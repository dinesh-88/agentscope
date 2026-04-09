import type { MetadataRoute } from "next";

import { resolveSiteUrl } from "@/lib/site-url";

const baseUrl = resolveSiteUrl();

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = [
    "",
    "/features",
    "/pricing",
    "/docs",
    "/why-ai-agents-fail",
    "/llm-observability",
    "/debug-ai-agents",
    "/multi-agent-monitoring",
    "/ai-agent-tracing",
    "/docs/security",
    "/demo",
    "/status",
    "/legal/privacy",
    "/legal/terms",
  ];

  return routes.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
