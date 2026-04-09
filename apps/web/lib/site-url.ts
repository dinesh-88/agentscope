const LOCALHOST_FALLBACK = "http://localhost:3000";

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return LOCALHOST_FALLBACK;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/+$/, "");
  }
  return `https://${trimmed}`.replace(/\/+$/, "");
}

export function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL;
  if (explicit && explicit.trim().length > 0) {
    return normalizeBaseUrl(explicit);
  }

  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProduction && vercelProduction.trim().length > 0) {
    return normalizeBaseUrl(vercelProduction);
  }

  const vercelPreview = process.env.VERCEL_URL;
  if (vercelPreview && vercelPreview.trim().length > 0) {
    return normalizeBaseUrl(vercelPreview);
  }

  return LOCALHOST_FALLBACK;
}

