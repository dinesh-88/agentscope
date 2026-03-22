#!/usr/bin/env node

import { chromium } from "playwright";

const BASE_URL = process.env.PRODUCT_TOUR_URL ?? "https://agentscope-chi.vercel.app";
const HEADLESS = process.env.HEADLESS === "1";
const SLOW_MO = Number(process.env.SLOW_MO ?? 300);
const SESSION_COOKIE = process.env.SESSION_COOKIE;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "agentscope_session";

async function ensureCinematicStyles(page) {
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

async function firstVisible(candidates) {
  for (const candidate of candidates) {
    if (await candidate.count()) {
      const target = candidate.first();
      if (await target.isVisible().catch(() => false)) {
        return target;
      }
    }
  }
  return null;
}

async function clickFirstVisible(candidates) {
  const target = await firstVisible(candidates);
  if (!target) return false;
  try {
    await target.click({ timeout: 2500 });
    return true;
  } catch {
    for (const candidate of candidates) {
      if (await candidate.count()) {
        try {
          await candidate.first().click({ timeout: 2500 });
          return true;
        } catch {
          // Try the next candidate if this one is not actionable.
        }
      }
    }
  }
  return false;
}

async function focusFadeBackground(page, locator) {
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
      overlay.style.opacity = "1";
    });

    const htmlEl = el;
    htmlEl.dataset.tourPrevPosition = htmlEl.style.position || "";
    htmlEl.dataset.tourPrevZ = htmlEl.style.zIndex || "";
    htmlEl.dataset.tourPrevTransition = htmlEl.style.transition || "";
    if (getComputedStyle(htmlEl).position === "static") {
      htmlEl.style.position = "relative";
    }
    htmlEl.style.zIndex = "2147483646";
    htmlEl.style.transition = htmlEl.style.transition
      ? `${htmlEl.style.transition}, box-shadow 420ms ease, transform 420ms ease, outline 420ms ease`
      : "box-shadow 420ms ease, transform 420ms ease, outline 420ms ease";
  });
}

async function clearFocusFadeBackground(page, locator) {
  await locator.first().evaluate((el) => {
    const htmlEl = el;
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
    overlay.style.opacity = "0";
    window.setTimeout(() => {
      const activeOverlay = document.getElementById("__tour_focus_overlay");
      if (activeOverlay?.getAttribute("data-active") === "true") {
        activeOverlay.remove();
      }
    }, 320);
  });
}

async function highlightElement(page, locator, durationMs = 2300) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30000 });
  await focusFadeBackground(page, target);
  await target.evaluate((el) => {
    const htmlEl = el;
    htmlEl.dataset.tourPrevOutline = htmlEl.style.outline || "";
    htmlEl.dataset.tourPrevOutlineOffset = htmlEl.style.outlineOffset || "";
    htmlEl.dataset.tourPrevShadow = htmlEl.style.boxShadow || "";
    htmlEl.style.outline = "2px solid #00ffcc";
    htmlEl.style.outlineOffset = "2px";
    htmlEl.style.boxShadow = "0 0 20px rgba(0,255,200,0.6)";
  });
  await page.waitForTimeout(durationMs);
  await target.evaluate((el) => {
    const htmlEl = el;
    htmlEl.style.outline = htmlEl.dataset.tourPrevOutline ?? "";
    htmlEl.style.outlineOffset = htmlEl.dataset.tourPrevOutlineOffset ?? "";
    htmlEl.style.boxShadow = htmlEl.dataset.tourPrevShadow ?? "";
    delete htmlEl.dataset.tourPrevOutline;
    delete htmlEl.dataset.tourPrevOutlineOffset;
    delete htmlEl.dataset.tourPrevShadow;
  });
  await clearFocusFadeBackground(page, target);
}

async function smoothScrollToLocator(page, locator, durationMs = 900) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30000 });
  await target.evaluate(async (el, ms) => {
    const rect = el.getBoundingClientRect();
    const startY = window.scrollY;
    const targetY = startY + rect.top - window.innerHeight / 2 + rect.height / 2;
    const diff = targetY - startY;
    if (Math.abs(diff) < 6) return;
    const start = performance.now();
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    await new Promise((resolve) => {
      const step = (now) => {
        const progress = Math.min((now - start) / ms, 1);
        const eased = easeInOut(progress);
        window.scrollTo(0, startY + diff * eased);
        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }, durationMs);
}

async function zoomInto(page, locator, durationMs = 2200, scale = 1.08) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30000 });
  await smoothScrollToLocator(page, target, 1000);
  await focusFadeBackground(page, target);
  await target.evaluate(
    (el, zoomScale) => {
      const htmlEl = el;
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
      while (textNode && !(textNode.textContent ?? "").trim()) {
        textNode = walker.nextNode();
      }
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

      const elementMidX = elementRect.left + elementRect.width / 2;
      if (elementMidX < window.innerWidth * 0.35) {
        htmlEl.style.transformOrigin = "left center";
      } else if (elementMidX > window.innerWidth * 0.65) {
        htmlEl.style.transformOrigin = "right center";
      } else {
        htmlEl.style.transformOrigin = "center center";
      }

      const lens = document.createElement("div");
      lens.id = "__tour_magnifier";
      lens.style.position = "fixed";
      lens.style.width = "170px";
      lens.style.height = "170px";
      lens.style.borderRadius = "50%";
      lens.style.border = "2px solid rgba(255,255,255,0.85)";
      lens.style.boxShadow = "0 0 0 2px rgba(0,255,200,0.35), 0 10px 30px rgba(0,0,0,0.45)";
      lens.style.background = "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0.08) 45%, rgba(0,0,0,0.05) 85%)";
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
    const htmlEl = el;
    htmlEl.style.transform = htmlEl.dataset.tourPrevTransform ?? "";
    htmlEl.style.transformOrigin = htmlEl.dataset.tourPrevTransformOrigin ?? "";
    htmlEl.style.willChange = htmlEl.dataset.tourPrevWillChange ?? "";
    delete htmlEl.dataset.tourPrevTransform;
    delete htmlEl.dataset.tourPrevTransformOrigin;
    delete htmlEl.dataset.tourPrevWillChange;

    const lens = document.getElementById("__tour_magnifier");
    if (lens) {
      lens.style.opacity = "0";
      lens.style.transform = "translate(-50%, -50%) scale(0.92)";
      window.setTimeout(() => lens.remove(), 340);
    }
  });
  await clearFocusFadeBackground(page, target);
}

async function slowHover(page, locator, durationMs = 1000) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 30000 });
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

async function waitForUrlContains(page, fragment, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.url().includes(fragment)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function ensureComparisonResultPage(page) {
  if (/\/runs\/compare\/[^/]+\/[^/]+/.test(page.url())) return;
  if (!/\/runs\/compare(\/.*)?(\?.*)?$/.test(page.url())) return;

  const compareRunsButton = page.getByRole("button", { name: /^compare runs$/i }).first();
  if (!(await compareRunsButton.count())) return;

  if (await compareRunsButton.isDisabled().catch(() => true)) {
    const selects = page.locator("select");
    if ((await selects.count()) >= 4) {
      const runASelect = selects.nth(1);
      const runBSelect = selects.nth(3);
      const runAValue = await runASelect.inputValue().catch(() => "");
      const runBOptions = await runBSelect
        .locator("option")
        .evaluateAll((options) => options.map((opt) => ({ value: opt.getAttribute("value") ?? "" })));
      const alternate = runBOptions.find((opt) => opt.value && opt.value !== runAValue);
      if (alternate) {
        await runBSelect.selectOption(alternate.value);
        await page.waitForTimeout(1500);
      }
    }
  }

  if (!(await compareRunsButton.isDisabled().catch(() => true))) {
    await compareRunsButton.click();
    await waitForUrlContains(page, "/runs/compare/", 12000);
  }
}

async function runProductTour() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    slowMo: SLOW_MO,
  });
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await context.newPage();

  try {
    const base = new URL(BASE_URL);
    if (SESSION_COOKIE) {
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

    // 1. Open homepage
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(10000);
    await page.waitForTimeout(2000);

    // 2. Run demo
    const openedDemo = await clickFirstVisible([
      page.locator('[data-testid="run-demo-button"]'),
      page.getByRole("button", { name: /^run demo$/i }),
      page.getByRole("link", { name: /^run demo$/i }),
      page.getByRole("button", { name: /run the demo/i }),
      page.getByRole("link", { name: /run the demo/i }),
      page.getByRole("link", { name: /watch 90-second product tour/i }),
    ]);
    if (!openedDemo) {
      throw new Error("Could not find a Run Demo trigger on the page.");
    }
    await page.waitForTimeout(4000);

    if (/\/demo(\/.*)?(\?.*)?$/.test(page.url())) {
      const openedRuns = await clickFirstVisible([
        page.getByRole("link", { name: /^open runs$/i }),
        page.getByRole("button", { name: /^open runs$/i }),
        page.locator('a[href="/runs"]'),
      ]);
      if (!openedRuns) {
        throw new Error("Reached /demo but could not find an Open runs trigger.");
      }
      await page.waitForTimeout(2000);
    }

    // 3. Wait for runs page
    let onRunsPage = await waitForUrlContains(page, "/runs", 12000);
    if (!onRunsPage) {
      await page.goto(new URL("/runs", page.url()).toString(), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      onRunsPage = await waitForUrlContains(page, "/runs", 12000);
    }
    if (!onRunsPage) {
      if (/\/login(\/.*)?(\?.*)?$/.test(page.url())) {
        throw new Error(
          `Redirected to login (${page.url()}). This product-tour flow requires an authenticated session on ${base.hostname}. ` +
            `Set SESSION_COOKIE (and optionally SESSION_COOKIE_NAME, default: ${SESSION_COOKIE_NAME}) and run again.`,
        );
      }
      throw new Error(`Could not reach /runs. Current URL: ${page.url()}`);
    }
    await page.waitForTimeout(1200);

    // 0–3s (HOOK): show failed run in runs list
    const failedRunRow =
      (await firstVisible([page.locator('[data-testid="run-item"]').filter({ hasText: /failed|error/i })])) ??
      page.locator('[data-testid="run-item"]').first();
    await failedRunRow.waitFor({ state: "visible", timeout: 30000 });
    await highlightElement(page, failedRunRow, 2200);

    // 3–8s: open failed run and zoom to failure
    await failedRunRow.click();
    if (!/\/runs\/[^/?#]+/.test(page.url())) {
      const failedRunLink = failedRunRow.locator('a[href*="/runs/"]').first();
      if (await failedRunLink.count()) {
        await failedRunLink.click();
      }
    }
    await waitForUrlContains(page, "/runs/", 12000);
    await page.waitForTimeout(1600);

    // 8–15s: briefly show span timeline
    const runContainer = page.getByText(/^span timeline$/i).first();
    await runContainer.waitFor({ state: "visible", timeout: 30000 });
    await zoomInto(page, runContainer, 1800, 1.07);
    await page.waitForTimeout(1700);

    const firstSpan = page.locator('[data-testid="span-item"]').first();
    await firstSpan.waitFor({ state: "visible", timeout: 30000 });
    await firstSpan.click();
    await page.waitForTimeout(1500);

    // Failure moment: zoom + highlight
    await clickFirstVisible([page.getByRole("button", { name: /^response$/i })]);
    await page.waitForTimeout(1500);
    const failureTarget = await firstVisible([
      page.getByText(/invalid json/i),
      page.locator('p:has-text("Status") + p').filter({ hasText: /error|failed/i }),
      page.getByText(/^error$/i),
      page.getByText(/^failed$/i),
    ]);
    if (failureTarget) {
      await failureTarget.click({ timeout: 2500 }).catch(() => {});
      await zoomInto(page, failureTarget, 1800, 1.08);
      await highlightElement(page, failureTarget, 2000);
    }
    await page.waitForTimeout(1800);

    // 15–25s: open insights and hold
    const insightsButton = page.getByRole("button", { name: /^insights$/i });
    await insightsButton.waitFor({ state: "visible", timeout: 30000 });
    await insightsButton.click();
    await page.waitForTimeout(1800);
    const insightsPanel = page.locator('[data-testid="insights-panel"]').first();
    if (await insightsPanel.count()) {
      await highlightElement(page, insightsPanel, 2600);
    }
    await page.waitForTimeout(2200);

    // 25–40s: scroll insights (2–3 items)
    await page.evaluate(() => window.scrollBy({ top: 320, left: 0, behavior: "smooth" }));
    await page.waitForTimeout(2400);
    await page.evaluate(() => window.scrollBy({ top: 320, left: 0, behavior: "smooth" }));
    await page.waitForTimeout(2400);
    await page.evaluate(() => window.scrollBy({ top: 280, left: 0, behavior: "smooth" }));
    await page.waitForTimeout(2400);

    // 40–60s: comparison, summary zoom, hover latency + tokens
    const compareButton = page.getByRole("button", { name: /compare/i }).first();
    const compareLink = page.getByRole("link", { name: /compare/i }).first();
    if (await compareButton.count()) {
      await compareButton.click();
    } else {
      await compareLink.click();
    }
    await page.waitForTimeout(2200);
    await ensureComparisonResultPage(page);
    await page.waitForTimeout(1800);

    const metricsSection = page.getByText(/^comparison summary$/i).first();
    await metricsSection.waitFor({ state: "visible", timeout: 30000 });
    await zoomInto(page, metricsSection, 2200, 1.08);
    await page.waitForTimeout(1700);

    const latency = page.getByText(/^latency$/i).first();
    await latency.waitFor({ state: "visible", timeout: 30000 });
    await slowHover(page, latency, 1000);
    await page.waitForTimeout(1700);

    const tokenUsage = page.getByText(/token usage/i).first();
    await tokenUsage.waitFor({ state: "visible", timeout: 30000 });
    await slowHover(page, tokenUsage, 1000);
    await page.waitForTimeout(1700);

    // 60–70s: verdict money shot
    const verdictText = await firstVisible([
      page.getByText(/run b is better/i),
      page.getByText(/better/i),
    ]);
    const useVersionCta = await firstVisible([
      page.getByRole("link", { name: /use this version/i }),
      page.getByText(/use this version/i),
    ]);

    if (verdictText) {
      await highlightElement(page, verdictText, 2200);
      await page.waitForTimeout(1800);
    }
    if (useVersionCta) {
      await slowHover(page, useVersionCta, 1000);
    }
    await page.waitForTimeout(9000);
  } finally {
    await context.close();
    await browser.close();
  }
}

runProductTour().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
