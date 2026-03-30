#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

function loadEnvFile(filePath) {
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

function preloadEnv() {
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

const BASE_URL = process.env.DEMO_URL ?? "http://localhost:3000";
const HEADLESS = process.env.HEADLESS === "1";
const VIDEO_DIR = path.resolve(process.cwd(), process.env.VIDEO_DIR ?? "apps/web/videos");
const VIEWPORT = { width: 1440, height: 900 };
const SLOW_MO = Number(process.env.SLOW_MO ?? 80);
const SESSION_COOKIE = process.env.SESSION_COOKIE;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "agentscope_session";

const PAUSE = {
  step1: 2_500,
  step2: 2_000,
  step3: 4_000,
  step4: 4_000,
  step5: 4_000,
  step6: 3_000,
  step7: 3_000,
  micro: 180,
  small: 320,
};

const cursorPosition = {
  x: Math.round(VIEWPORT.width * 0.5),
  y: Math.round(VIEWPORT.height * 0.35),
};

function ensureVideoDir() {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
}

async function wait(page, ms) {
  await page.waitForTimeout(ms);
}

async function ensureCursorGlow(page) {
  await page.evaluate(() => {
    if (document.getElementById("__demo_cursor_glow")) return;

    const style = document.createElement("style");
    style.id = "__demo_cursor_glow_style";
    style.textContent = `
      #__demo_cursor_glow {
        position: fixed;
        width: 26px;
        height: 26px;
        margin-left: -13px;
        margin-top: -13px;
        border-radius: 999px;
        pointer-events: none;
        z-index: 2147483647;
        background: radial-gradient(circle, rgba(0,255,200,0.42) 0%, rgba(0,255,200,0.14) 45%, rgba(0,255,200,0.02) 78%, rgba(0,255,200,0) 100%);
        box-shadow: 0 0 18px rgba(0, 255, 200, 0.55);
        transform: translate(-9999px, -9999px);
      }
      html, body, a, button, input, textarea, select, [role="button"] {
        cursor: none !important;
      }
    `;
    document.head.appendChild(style);

    const glow = document.createElement("div");
    glow.id = "__demo_cursor_glow";
    document.body.appendChild(glow);
  });
}

async function setCursorGlow(page, x, y) {
  await page.evaluate(
    ({ nextX, nextY }) => {
      const glow = document.getElementById("__demo_cursor_glow");
      if (!glow) return;
      glow.style.transform = `translate(${nextX}px, ${nextY}px)`;
    },
    { nextX: x, nextY: y },
  );
}

async function moveMouseSmooth(page, toX, toY, steps = 24, totalMs = 380) {
  const stepCount = Math.max(20, Math.min(30, steps));
  const fromX = cursorPosition.x;
  const fromY = cursorPosition.y;
  const framePause = Math.max(8, Math.floor(totalMs / stepCount));

  for (let i = 1; i <= stepCount; i += 1) {
    const t = i / stepCount;
    const x = Math.round(fromX + (toX - fromX) * t);
    const y = Math.round(fromY + (toY - fromY) * t);
    await page.mouse.move(x, y);
    await setCursorGlow(page, x, y);
    await page.waitForTimeout(framePause);
  }

  cursorPosition.x = Math.round(toX);
  cursorPosition.y = Math.round(toY);
}

async function autoZoom(page, locator, options = {}) {
  const { scale = 1.04, holdMs = 140, inMs = 160, outMs = 220 } = options;
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 20_000 });

  await target.evaluate(
    (el, { zoomScale, enterMs }) => {
      const htmlEl = el;
      htmlEl.dataset.demoPrevTransform = htmlEl.style.transform || "";
      htmlEl.dataset.demoPrevTransition = htmlEl.style.transition || "";
      htmlEl.dataset.demoPrevShadow = htmlEl.style.boxShadow || "";
      htmlEl.style.transformOrigin = "center center";
      htmlEl.style.transition = `transform ${enterMs}ms ease, box-shadow ${enterMs}ms ease`;
      htmlEl.style.transform = `scale(${zoomScale})`;
      htmlEl.style.boxShadow = "0 0 0 2px rgba(0,255,200,0.35), 0 10px 24px rgba(0,0,0,0.22)";
    },
    { zoomScale: scale, enterMs: inMs },
  );
  await page.waitForTimeout(holdMs);

  await target.evaluate(
    (el, leaveMs) => {
      const htmlEl = el;
      htmlEl.style.transition = `transform ${leaveMs}ms ease, box-shadow ${leaveMs}ms ease`;
      htmlEl.style.transform = htmlEl.dataset.demoPrevTransform ?? "";
      htmlEl.style.boxShadow = htmlEl.dataset.demoPrevShadow ?? "";
      window.setTimeout(() => {
        const current = el;
        current.style.transition = current.dataset.demoPrevTransition ?? "";
        delete current.dataset.demoPrevTransform;
        delete current.dataset.demoPrevTransition;
        delete current.dataset.demoPrevShadow;
      }, leaveMs + 20);
    },
    outMs,
  );
  await page.waitForTimeout(outMs + 20);
}

async function addSessionCookieIfProvided(context) {
  if (!SESSION_COOKIE) return;

  const base = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: SESSION_COOKIE,
      domain: base.hostname,
      path: "/",
      httpOnly: false,
      secure: base.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

async function firstVisible(candidates) {
  for (const locator of candidates) {
    const first = locator.first();
    if (await first.isVisible().catch(() => false)) {
      return first;
    }
  }
  return null;
}

async function moveMouseToLocator(page, locator, steps = 24) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 20_000 });
  const box = await target.boundingBox();
  if (!box) return;

  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await moveMouseSmooth(page, x, y, steps, 360);
}

async function sweepAcrossLocator(page, locator, durationMs = 1300) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 20_000 });
  const box = await target.boundingBox();
  if (!box) return;

  const startX = Math.round(box.x + Math.max(10, box.width * 0.1));
  const endX = Math.round(box.x + Math.min(box.width - 10, box.width * 0.9));
  const y = Math.round(box.y + box.height / 2);
  const steps = 24;
  const framePause = Math.max(16, Math.floor(durationMs / steps));

  await moveMouseSmooth(page, startX, y, 22, 260);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(startX + (endX - startX) * t);
    await page.mouse.move(x, y);
    await setCursorGlow(page, x, y);
    cursorPosition.x = x;
    cursorPosition.y = y;
    await page.waitForTimeout(framePause);
  }
}

async function smoothScrollBy(page, distancePx, durationMs = 700) {
  const steps = 20;
  const delta = distancePx / steps;
  const framePause = Math.max(10, Math.floor(durationMs / steps));

  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(framePause);
  }
}

async function clickWithMotion(page, locator) {
  const target = locator.first();
  await moveMouseToLocator(page, target, 26);
  await autoZoom(page, target, { scale: 1.1, holdMs: 120, inMs: 140, outMs: 280 });
  await wait(page, PAUSE.small);
  await setCursorGlow(page, cursorPosition.x, cursorPosition.y);
  await page.mouse.down();
  await wait(page, 70);
  await page.mouse.up();
}

function runRows(page) {
  return page.locator('[data-testid="run-item"], tbody tr:has(a[href*="/runs/"])');
}

async function findFailedRunRow(page) {
  const rows = runRows(page);
  await rows.first().waitFor({ state: "visible", timeout: 30_000 });

  const failedRow = rows.filter({ hasText: /fail(?:ed|ure)?|error|exception/i }).first();
  if (await failedRow.isVisible().catch(() => false)) {
    return failedRow;
  }

  const observedStatuses = await rows
    .locator("td:nth-child(3) span")
    .allTextContents()
    .then((items) => items.map((item) => item.trim()).filter(Boolean))
    .catch(() => []);

  throw new Error(
    `No failed run found in table. Observed statuses: ${observedStatuses.join(", ") || "none"}. Seed at least one FAILED run.`,
  );
}

async function openRunsPage(page) {
  await page.goto(`${BASE_URL}/runs`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  if (page.url().includes("/login")) {
    throw new Error(
      "Redirected to /login. Set SESSION_COOKIE (and optionally SESSION_COOKIE_NAME) for authenticated capture.",
    );
  }

  await runRows(page).first().waitFor({ state: "visible", timeout: 30_000 });
  await ensureCursorGlow(page);
  await setCursorGlow(page, cursorPosition.x, cursorPosition.y);
}

async function cinematicRunsSweep(page) {
  const rows = runRows(page);
  const count = Math.min(await rows.count(), 4);

  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    await moveMouseToLocator(page, row, 24);
    await wait(page, PAUSE.micro);
  }
}

async function revealFailureReason(page) {
  const header = page.locator("div.border-b.border-white\\/5").first();
  await header.waitFor({ state: "visible", timeout: 20_000 });

  await autoZoom(page, header, { scale: 1.07, holdMs: 160, inMs: 160, outMs: 300 });
  await moveMouseToLocator(page, header, 24);
  await wait(page, PAUSE.small);

  const failureMessage = await firstVisible([
    header.locator("p").filter({ hasText: /fail|error|invalid|json|parse|timeout/i }),
    page.locator("p").filter({ hasText: /fail|error|invalid|json|parse|timeout/i }),
  ]);

  if (failureMessage) {
    await sweepAcrossLocator(page, failureMessage, 1300);
  } else {
    await sweepAcrossLocator(page, header, 1300);
  }
}

async function highlightInsights(page) {
  await smoothScrollBy(page, 240, 650);

  const insightCard = await firstVisible([
    page
      .locator("div")
      .filter({ has: page.getByText(/^Cause$/i) })
      .filter({ has: page.getByText(/^Fix$/i) }),
    page.locator("div").filter({ hasText: /Root Cause Analysis/i }),
  ]);

  if (!insightCard) {
    return null;
  }

  await autoZoom(page, insightCard, { scale: 1.08, holdMs: 180, inMs: 160, outMs: 300 });
  await moveMouseToLocator(page, insightCard, 24);
  await wait(page, PAUSE.small);

  const reasonBlock = await firstVisible([
    insightCard.locator("p").first(),
    insightCard.locator("div.text-sm").first(),
  ]);
  if (reasonBlock) {
    await moveMouseToLocator(page, reasonBlock, 22);
    await wait(page, PAUSE.micro);
  }

  const causeLabel = insightCard.getByText(/^Cause$/i).first();
  if (await causeLabel.isVisible().catch(() => false)) {
    await moveMouseToLocator(page, causeLabel, 22);
    await wait(page, PAUSE.micro);
  }

  const fixLabel = insightCard.getByText(/^Fix$/i).first();
  if (await fixLabel.isVisible().catch(() => false)) {
    await moveMouseToLocator(page, fixLabel, 22);
    await wait(page, PAUSE.micro);
  }

  return insightCard;
}

async function showTimeline(page) {
  const timelineHeading = page.getByRole("heading", { name: /^Timeline$/i }).first();
  await timelineHeading.waitFor({ state: "visible", timeout: 20_000 });

  await autoZoom(page, timelineHeading, { scale: 1.07, holdMs: 160, inMs: 160, outMs: 300 });
  await moveMouseToLocator(page, timelineHeading, 24);
  await wait(page, PAUSE.small);

  const timelineRows = page.locator("div.relative.flex.h-8.cursor-pointer");
  const count = Math.min(await timelineRows.count(), 5);
  for (let i = 0; i < count; i += 1) {
    const row = timelineRows.nth(i);
    await row.scrollIntoViewIfNeeded();
    await sweepAcrossLocator(page, row, 780);
  }

  const failedBar = await firstVisible([
    page.locator("div.bg-red-400.border-red-300"),
    page.locator("div.bg-red-400"),
  ]);

  if (!failedBar) {
    throw new Error("Timeline is visible, but no FAILED span (red bar) was found.");
  }

  await autoZoom(page, failedBar, { scale: 1.1, holdMs: 200, inMs: 160, outMs: 320 });
  await moveMouseToLocator(page, failedBar, 26);
  return failedBar;
}

async function clickFailedSpan(page, failedBar) {
  await clickWithMotion(page, failedBar);
  await page.getByRole("heading", { name: /Step Details/i }).first().waitFor({ state: "visible", timeout: 20_000 });
}

async function settleEndFrame(page, insightCard, failedBar) {
  // Keep the frame stable while trying to keep both context areas visible.
  if (insightCard && !(await insightCard.isVisible().catch(() => false))) {
    await smoothScrollBy(page, 120, 380);
  }

  if (await failedBar.isVisible().catch(() => false)) {
    await moveMouseToLocator(page, failedBar, 22);
  } else if (insightCard && (await insightCard.isVisible().catch(() => false))) {
    await moveMouseToLocator(page, insightCard, 22);
  }

  await wait(page, PAUSE.step7);
}

async function main() {
  ensureVideoDir();

  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO,
  });

  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: {
      dir: VIDEO_DIR,
      size: VIEWPORT,
    },
  });

  const page = await context.newPage();
  const video = page.video();
  let completed = false;

  try {
    await addSessionCookieIfProvided(context);

    // 1) Open Runs page + sweep + hover FAILED row
    await openRunsPage(page);
    await moveMouseSmooth(page, cursorPosition.x, cursorPosition.y, 20, 220);
    await setCursorGlow(page, cursorPosition.x, cursorPosition.y);
    await cinematicRunsSweep(page);
    const failedRunRow = await findFailedRunRow(page);
    await autoZoom(page, failedRunRow, { scale: 1.08, holdMs: 170, inMs: 160, outMs: 300 });
    await moveMouseToLocator(page, failedRunRow, 26);
    await wait(page, PAUSE.step1);

    // 2) Click failed run + load wait
    const runLink = failedRunRow.locator('a[href*="/runs/"]').first();
    await clickWithMotion(page, runLink);
    await page.waitForURL(/\/runs\/[^/]+$/);
    await page.waitForLoadState("networkidle");
    await ensureCursorGlow(page);
    await setCursorGlow(page, cursorPosition.x, cursorPosition.y);
    await wait(page, PAUSE.step2);

    // 3) Reveal failure reason
    await revealFailureReason(page);
    await wait(page, PAUSE.step3);

    // 4) Highlight insights (reason/cause/fix)
    const insightCard = await highlightInsights(page);
    await wait(page, PAUSE.step4);

    // 5) Show timeline and stop on FAILED span
    const failedBar = await showTimeline(page);
    await wait(page, PAUSE.step5);

    // 6) Click failure and wait details
    await clickFailedSpan(page, failedBar);
    await wait(page, PAUSE.step6);

    // 7) End frame
    await settleEndFrame(page, insightCard, failedBar);

    completed = true;
  } finally {
    await page.close();
    await context.close();

    if (video) {
      const videoPath = await video.path();
      if (completed) {
        console.log(`Demo video saved to: ${videoPath}`);
      } else {
        console.log(`Partial video saved (script exited early): ${videoPath}`);
      }
    }

    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
