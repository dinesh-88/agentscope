import type { MetadataRoute } from "next";

import { resolveSiteUrl } from "@/lib/site-url";

const baseUrl = resolveSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
