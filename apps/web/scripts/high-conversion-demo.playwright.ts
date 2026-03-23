#!/usr/bin/env ts-node

/**
 * VIDEO_SCRIPT
 * Scene 1 (0-5s): Problem setup on Runs page.
 * Purpose: establish this is an agent debugging workflow, not a generic dashboard.
 *
 * Scene 2 (5-10s): Failed run spotlight.
 * Purpose: show failure quickly (cold viewer understands the pain in <10s).
 *
 * Scene 3 (10-17s): Failure summary in failed run detail.
 * Purpose: show the most useful failure signal first.
 *
 * Scene 4 (17-25s): Step-by-step trace.
 * Purpose: show where the agent broke in execution flow.
 *
 * Scene 5 (25-31s): Problem step deep-dive (LLM/tool call context).
 * Purpose: reveal likely root cause in prompt/response/metadata.
 *
 * Scene 6 (31-36s): Successful run after fix.
 * Purpose: prove outcome improved.
 *
 * Scene 7 (36-45s): Compare failed vs fixed run.
 * Purpose: end on clear before/after insight and verdict.
 */

import { chromium, type Locator, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type RunStatus = "failed" | "success";

type RunSelection = {
  status: RunStatus;
  row: Locator;
  runId: string;
};

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || key in process.env) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function preloadEnv(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "../../..");
  const candidates = [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), ".env.local"),
  ];

  for (const filePath of candidates) {
    loadEnvFile(filePath);
  }
}

preloadEnv();

const CONFIG = {
  BASE_URL: process.env.DEMO_URL ?? "http://localhost:3000",
  HEADLESS: process.env.HEADLESS === "1",
  SLOW_MO: Number(process.env.SLOW_MO ?? 120),
  VIEWPORT: { width: 1512, height: 982 },
  SESSION_COOKIE: process.env.SESSION_COOKIE,
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME ?? "agentscope_session",
};

const PAUSE_DURATIONS = {
  short: 500,
  medium: 1100,
  long: 1800,
  sceneHold: 2400,
  beforeClick: 350,
  afterNavigation: 1400,
  outroHold: 5000,
} as const;

const SELECTORS = {
  runsTableRows: '[data-testid="run-item"]',
  runsTableRowsFallback: 'tbody tr:has(a[href*="/runs/"])',
  compareButton: '[data-testid="compare-button"]',
  insightsPanel: '[data-testid="insights-panel"]',
  spanItem: '[data-testid="span-item"]',
  // TODO: If your UI uses different labels for error summaries, update this locator set.
  failureSummaryCandidates: [
    "div:has-text('failed')",
    "div:has-text('error')",
    "div:has-text('recommendation')",
  ],
};

async function pause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

async function waitForVisible(locator: Locator, timeout = 20_000) {
  await locator.first().waitFor({ state: "visible", timeout });
}

function runRows(page: Page): Locator {
  return page.locator(`${SELECTORS.runsTableRows}, ${SELECTORS.runsTableRowsFallback}`);
}

async function moveMouseToLocator(page: Page, locator: Locator, steps = 20) {
  const box = await locator.first().boundingBox();
  if (!box) return;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y, { steps });
}

async function ensureCinematicStyles(page: Page) {
  await page.evaluate(() => {
    if (document.getElementById("__tour_cinematic_styles")) return;
    const style = document.createElement("style");
    style.id = "__tour_cinematic_styles";
    style.textContent = `
      .__tour-focus-overlay {
        position: fixed;
        inset: 0;
        background: rgba(6, 10, 18, 0.48);
        pointer-events: none;
        z-index: 2147483645;
        opacity: 0;
        transition: opacity 280ms ease;
      }
    `;
    document.head.appendChild(style);
  });
}

async function smoothScrollToLocator(page: Page, locator: Locator, durationMs = 900) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  await target.evaluate(async (el, ms) => {
    const rect = el.getBoundingClientRect();
    const startY = window.scrollY;
    const targetY = startY + rect.top - window.innerHeight / 2 + rect.height / 2;
    const diff = targetY - startY;
    if (Math.abs(diff) < 6) return;
    const start = performance.now();
    const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        const progress = Math.min((now - start) / ms, 1);
        const eased = easeInOut(progress);
        window.scrollTo(0, startY + diff * eased);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }, durationMs);
}

async function focusFadeBackground(page: Page, locator: Locator) {
  await ensureCinematicStyles(page);
  const target = locator.first();
  await smoothScrollToLocator(page, target, 850);
  await target.evaluate((el) => {
    let overlay = document.getElementById("__tour_focus_overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "__tour_focus_overlay";
      overlay.className = "__tour-focus-overlay";
      document.body.appendChild(overlay);
    }
    overlay.setAttribute("data-active", "true");
    requestAnimationFrame(() => {
      (overlay as HTMLElement).style.opacity = "1";
    });

    const htmlEl = el as HTMLElement;
    htmlEl.dataset.tourPrevPosition = htmlEl.style.position || "";
    htmlEl.dataset.tourPrevZ = htmlEl.style.zIndex || "";
    htmlEl.dataset.tourPrevTransition = htmlEl.style.transition || "";
    if (getComputedStyle(htmlEl).position === "static") htmlEl.style.position = "relative";
    htmlEl.style.zIndex = "2147483646";
    htmlEl.style.transition = htmlEl.style.transition
      ? `${htmlEl.style.transition}, box-shadow 420ms ease, transform 420ms ease, outline 420ms ease`
      : "box-shadow 420ms ease, transform 420ms ease, outline 420ms ease";
  });
}

async function clearFocusFadeBackground(page: Page, locator: Locator) {
  await locator.first().evaluate((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.position = htmlEl.dataset.tourPrevPosition ?? "";
    htmlEl.style.zIndex = htmlEl.dataset.tourPrevZ ?? "";
    htmlEl.style.transition = htmlEl.dataset.tourPrevTransition ?? "";
    delete htmlEl.dataset.tourPrevPosition;
    delete htmlEl.dataset.tourPrevZ;
    delete htmlEl.dataset.tourPrevTransition;
  });
  await page.evaluate(() => {
    const overlay = document.getElementById("__tour_focus_overlay");
    if (!overlay) return;
    (overlay as HTMLElement).style.opacity = "0";
    window.setTimeout(() => {
      const activeOverlay = document.getElementById("__tour_focus_overlay");
      if (activeOverlay?.getAttribute("data-active") === "true") activeOverlay.remove();
    }, 320);
  });
}

async function highlightElement(page: Page, locator: Locator, durationMs = 2300) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  await focusFadeBackground(page, target);
  await target.evaluate((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.dataset.tourPrevOutline = htmlEl.style.outline || "";
    htmlEl.dataset.tourPrevOutlineOffset = htmlEl.style.outlineOffset || "";
    htmlEl.dataset.tourPrevShadow = htmlEl.style.boxShadow || "";
    htmlEl.style.outline = "2px solid #00ffcc";
    htmlEl.style.outlineOffset = "2px";
    htmlEl.style.boxShadow = "0 0 20px rgba(0,255,200,0.6)";
  });
  await page.waitForTimeout(durationMs);
  await target.evaluate((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.outline = htmlEl.dataset.tourPrevOutline ?? "";
    htmlEl.style.outlineOffset = htmlEl.dataset.tourPrevOutlineOffset ?? "";
    htmlEl.style.boxShadow = htmlEl.dataset.tourPrevShadow ?? "";
    delete htmlEl.dataset.tourPrevOutline;
    delete htmlEl.dataset.tourPrevOutlineOffset;
    delete htmlEl.dataset.tourPrevShadow;
  });
  await clearFocusFadeBackground(page, target);
}

async function zoomInto(page: Page, locator: Locator, durationMs = 2200, scale = 1.08) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  await smoothScrollToLocator(page, target, 1000);
  await focusFadeBackground(page, target);
  await target.evaluate(
    (el, zoomScale) => {
      const htmlEl = el as HTMLElement;
      htmlEl.dataset.tourPrevTransform = htmlEl.style.transform || "";
      htmlEl.dataset.tourPrevTransformOrigin = htmlEl.style.transformOrigin || "";
      htmlEl.dataset.tourPrevWillChange = htmlEl.style.willChange || "";
      htmlEl.style.transformOrigin = "center center";
      htmlEl.style.willChange = "transform";
      htmlEl.style.transform = `scale(${zoomScale})`;

      const existing = document.getElementById("__tour_magnifier");
      if (existing) existing.remove();
      const elementRect = htmlEl.getBoundingClientRect();
      let anchorX = elementRect.left + elementRect.width / 2;
      let anchorY = elementRect.top + elementRect.height / 2;

      const walker = document.createTreeWalker(htmlEl, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode && !(textNode.textContent ?? "").trim()) textNode = walker.nextNode();
      if (textNode) {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        const textRect = range.getBoundingClientRect();
        if (textRect.width > 0 && textRect.height > 0) {
          anchorX = textRect.left + textRect.width / 2;
          anchorY = textRect.top + textRect.height / 2;
        }
      }

      const lensRadius = 85;
      const margin = 18;
      anchorX = Math.min(Math.max(anchorX, lensRadius + margin), window.innerWidth - lensRadius - margin);
      anchorY = Math.min(Math.max(anchorY, lensRadius + margin), window.innerHeight - lensRadius - margin);

      const lens = document.createElement("div");
      lens.id = "__tour_magnifier";
      lens.style.position = "fixed";
      lens.style.width = "170px";
      lens.style.height = "170px";
      lens.style.borderRadius = "50%";
      lens.style.border = "2px solid rgba(255,255,255,0.85)";
      lens.style.boxShadow = "0 0 0 2px rgba(0,255,200,0.35), 0 10px 30px rgba(0,0,0,0.45)";
      lens.style.background =
        "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0.08) 45%, rgba(0,0,0,0.05) 85%)";
      lens.style.pointerEvents = "none";
      lens.style.zIndex = "2147483647";
      lens.style.opacity = "0";
      lens.style.transform = "translate(-50%, -50%) scale(0.92)";
      lens.style.transition = "opacity 320ms ease, transform 320ms ease";
      lens.style.left = `${anchorX}px`;
      lens.style.top = `${anchorY}px`;

      const handle = document.createElement("div");
      handle.style.position = "absolute";
      handle.style.width = "64px";
      handle.style.height = "10px";
      handle.style.right = "-44px";
      handle.style.bottom = "16px";
      handle.style.borderRadius = "999px";
      handle.style.transform = "rotate(36deg)";
      handle.style.transformOrigin = "left center";
      handle.style.background = "linear-gradient(90deg, rgba(255,255,255,0.85), rgba(210,220,230,0.72))";
      handle.style.boxShadow = "0 2px 10px rgba(0,0,0,0.3)";
      lens.appendChild(handle);

      document.body.appendChild(lens);
      requestAnimationFrame(() => {
        lens.style.opacity = "1";
        lens.style.transform = "translate(-50%, -50%) scale(1)";
      });
    },
    scale,
  );
  await page.waitForTimeout(durationMs);
  await target.evaluate((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.transform = htmlEl.dataset.tourPrevTransform ?? "";
    htmlEl.style.transformOrigin = htmlEl.dataset.tourPrevTransformOrigin ?? "";
    htmlEl.style.willChange = htmlEl.dataset.tourPrevWillChange ?? "";
    delete htmlEl.dataset.tourPrevTransform;
    delete htmlEl.dataset.tourPrevTransformOrigin;
    delete htmlEl.dataset.tourPrevWillChange;

    const lens = document.getElementById("__tour_magnifier");
    if (lens) {
      (lens as HTMLElement).style.opacity = "0";
      (lens as HTMLElement).style.transform = "translate(-50%, -50%) scale(0.92)";
      window.setTimeout(() => lens.remove(), 340);
    }
  });
  await clearFocusFadeBackground(page, target);
}

async function slowHover(page: Page, locator: Locator, durationMs = 1000) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30_000 });
  await smoothScrollToLocator(page, target, 900);
  const box = await target.boundingBox();
  if (!box) return;
  const startX = Math.round(box.x + Math.max(10, box.width * 0.15));
  const startY = Math.round(box.y + Math.max(10, box.height * 0.25));
  const endX = Math.round(box.x + Math.min(box.width - 8, box.width * 0.85));
  const endY = Math.round(box.y + Math.min(box.height - 8, box.height * 0.75));
  const steps = 25;
  const perStep = Math.max(12, Math.floor(durationMs / steps));
  await page.mouse.move(startX, startY, { steps: 6 });
  for (let i = 1; i <= steps; i += 1) {
    const progress = i / steps;
    const x = Math.round(startX + (endX - startX) * progress);
    const y = Math.round(startY + (endY - startY) * progress);
    await page.mouse.move(x, y, { steps: 1 });
    await page.waitForTimeout(perStep);
  }
}

async function spotlight(page: Page, locator: Locator, holdMs: number = PAUSE_DURATIONS.medium) {
  await highlightElement(page, locator, holdMs);
}

async function hoverThenClick(page: Page, locator: Locator) {
  await waitForVisible(locator);
  await moveMouseToLocator(page, locator, 18);
  await pause(page, PAUSE_DURATIONS.beforeClick);
  await locator.first().click();
}

async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    const first = candidate.first();
    if (await first.isVisible().catch(() => false)) return first;
  }
  return null;
}

async function openRunsPage(page: Page): Promise<void> {
  await page.goto(`${CONFIG.BASE_URL}/runs`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/login")) {
    throw new Error(
      "Redirected to /login. Provide SESSION_COOKIE (and optionally SESSION_COOKIE_NAME) for authenticated demo capture.",
    );
  }

  const hasRows = await runRows(page).first().isVisible().catch(() => false);
  const emptyStateVisible = await page
    .getByText(/no runs yet|no runs found|generate your first trace/i)
    .first()
    .isVisible()
    .catch(() => false);

  if (!hasRows && emptyStateVisible) {
    throw new Error(
      "Runs page loaded but has no data. Generate at least one failed and one successful run before recording.",
    );
  }

  if (!hasRows) {
    await waitForVisible(runRows(page), 30_000);
  }
  await pause(page, PAUSE_DURATIONS.afterNavigation);
}

async function pickRunByStatus(page: Page, status: RunStatus): Promise<RunSelection> {
  const rows = runRows(page);
  const row = rows.filter({ hasText: status === "failed" ? /failed|error/i : /success|completed/i }).first();

  if (!(await row.isVisible().catch(() => false))) {
    throw new Error(`No ${status} run found on /runs. Seed demo data with both failed and successful executions.`);
  }

  const href = await row.locator('a[href*="/runs/"]').first().getAttribute("href");
  if (!href) {
    throw new Error(`Unable to extract run link for ${status} run. Add a deterministic selector for the run link.`);
  }

  const runId = href.split("/runs/")[1]?.split("?")[0]?.split("#")[0];
  if (!runId) {
    throw new Error(`Unable to parse run id from href: ${href}`);
  }

  return { status, row, runId };
}

async function openFailedRun(page: Page): Promise<string> {
  const failedRun = await pickRunByStatus(page, "failed");
  await spotlight(page, failedRun.row, PAUSE_DURATIONS.long);
  await zoomInto(page, failedRun.row, 1400, 1.05);
  await hoverThenClick(page, failedRun.row.locator('a[href*="/runs/"]').first());
  await page.waitForURL(/\/runs\/[^/]+$/);
  await pause(page, PAUSE_DURATIONS.afterNavigation);
  return failedRun.runId;
}

async function focusFailureSummary(page: Page): Promise<void> {
  const candidates: Locator[] = [
    page.locator("span").filter({ hasText: /failed|error/i }),
    ...SELECTORS.failureSummaryCandidates.map((selector) => page.locator(selector)),
    page.locator(SELECTORS.insightsPanel),
  ];
  const target = await firstVisible(candidates);
  if (target) {
    await spotlight(page, target, PAUSE_DURATIONS.sceneHold);
    return;
  }

  // TODO: Replace with app-specific selector when available.
  await pause(page, PAUSE_DURATIONS.sceneHold);
}

async function focusTraceView(page: Page): Promise<void> {
  const spanTimelineHeader = page.getByText(/^span timeline$/i).first();
  await waitForVisible(spanTimelineHeader);
  await zoomInto(page, spanTimelineHeader, 1600, 1.06);

  const traceItem = page.locator(SELECTORS.spanItem).first();
  await waitForVisible(traceItem);
  await slowHover(page, traceItem, 900);
  await hoverThenClick(page, traceItem);
  await pause(page, PAUSE_DURATIONS.medium);

  const failingTraceItem = page.locator(SELECTORS.spanItem).filter({ hasText: /error|failed|rca/i }).first();
  if (await failingTraceItem.isVisible().catch(() => false)) {
    await zoomInto(page, failingTraceItem, 1800, 1.08);
    await hoverThenClick(page, failingTraceItem);
  }
}

async function focusProblemStep(page: Page): Promise<void> {
  const responseTab = page.getByRole("button", { name: /^response$/i }).first();
  if (await responseTab.isVisible().catch(() => false)) {
    await hoverThenClick(page, responseTab);
    await pause(page, PAUSE_DURATIONS.medium);
  }

  const likelyRootCause = await firstVisible([
    page.getByText(/invalid json|timeout|rate limit|tool|exception|schema/i),
    page.getByText(/^error$/i),
    page.getByText(/^failed$/i),
    page.getByText(/status/i),
  ]);

  if (likelyRootCause) {
    await zoomInto(page, likelyRootCause, PAUSE_DURATIONS.sceneHold, 1.09);
  } else {
    // TODO: Replace with your exact failing LLM/tool call panel selector if different.
    await pause(page, PAUSE_DURATIONS.sceneHold);
  }

  const metadataTab = page.getByRole("button", { name: /^metadata$/i }).first();
  if (await metadataTab.isVisible().catch(() => false)) {
    await hoverThenClick(page, metadataTab);
    await pause(page, PAUSE_DURATIONS.short);
  }
}

async function openSuccessfulRun(page: Page): Promise<string> {
  await openRunsPage(page);
  await pause(page, PAUSE_DURATIONS.medium);

  const successRun = await pickRunByStatus(page, "success");
  await spotlight(page, successRun.row, PAUSE_DURATIONS.long);
  await hoverThenClick(page, successRun.row.locator('a[href*="/runs/"]').first());
  await page.waitForURL(/\/runs\/[^/]+$/);
  await pause(page, PAUSE_DURATIONS.afterNavigation);

  const successBadge = page.locator("span").filter({ hasText: /success|completed/i }).first();
  if (await successBadge.isVisible().catch(() => false)) {
    await spotlight(page, successBadge, PAUSE_DURATIONS.medium);
  }

  return successRun.runId;
}

async function openComparisonView(page: Page, failedRunId: string, successfulRunId: string): Promise<void> {
  // Direct compare URL keeps flow deterministic and short for recording.
  await page.goto(`${CONFIG.BASE_URL}/runs/compare/${failedRunId}/${successfulRunId}`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForURL(new RegExp(`/runs/compare/${failedRunId}/${successfulRunId}`));
  await pause(page, PAUSE_DURATIONS.afterNavigation);

  const insightsHeader = page.getByText(/^comparison insights$/i).first();
  await waitForVisible(insightsHeader);
  await zoomInto(page, insightsHeader, PAUSE_DURATIONS.long, 1.06);

  const summaryHeader = page.getByText(/^comparison summary$/i).first();
  await waitForVisible(summaryHeader);
  await zoomInto(page, summaryHeader, PAUSE_DURATIONS.long, 1.08);

  const verdict = await firstVisible([
    page.getByText(/run b|winner|better|verdict/i),
    page.getByRole("link", { name: /use this version/i }),
  ]);
  if (verdict) {
    await slowHover(page, verdict, 1000);
    await zoomInto(page, verdict, PAUSE_DURATIONS.sceneHold, 1.1);
  }
}

async function applySessionCookieIfProvided(page: Page): Promise<void> {
  if (!CONFIG.SESSION_COOKIE) return;

  const base = new URL(CONFIG.BASE_URL);
  await page.context().addCookies([
    {
      name: CONFIG.SESSION_COOKIE_NAME,
      value: CONFIG.SESSION_COOKIE,
      domain: base.hostname,
      path: "/",
      httpOnly: false,
      secure: base.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

async function main() {
  const browser = await chromium.launch({
    headless: CONFIG.HEADLESS,
    slowMo: CONFIG.SLOW_MO,
  });

  const context = await browser.newContext({ viewport: CONFIG.VIEWPORT });
  const page = await context.newPage();

  try {
    await applySessionCookieIfProvided(page);

    // Scene 1: Open runs page and establish context.
    await openRunsPage(page);

    // Scene 2 + 3: Show failed run and failure summary.
    const failedRunId = await openFailedRun(page);
    await focusFailureSummary(page);

    // Scene 4 + 5: Trace and root cause detail.
    await focusTraceView(page);
    await focusProblemStep(page);

    // Scene 6: Show successful run after fix.
    const successfulRunId = await openSuccessfulRun(page);

    // Scene 7: Compare failed vs fixed run and end here.
    await openComparisonView(page, failedRunId, successfulRunId);
    await pause(page, PAUSE_DURATIONS.outroHold);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
