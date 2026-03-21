#!/usr/bin/env node

import { chromium } from "playwright";

const BASE_URL = process.env.PRODUCT_TOUR_URL ?? "https://agentscope-chi.vercel.app";
const HEADLESS = process.env.HEADLESS === "1";
const SLOW_MO = 500;
const SESSION_COOKIE = process.env.SESSION_COOKIE;
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "agentscope_session";

function now() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${now()}] ${message}`);
}

async function waitMs(page, ms) {
  await page.waitForTimeout(ms);
}

async function stepDelay(page) {
  const delay = 1500 + Math.floor(Math.random() * 1501);
  await waitMs(page, delay);
}

async function safeClick(page, label, locators) {
  for (const locator of locators) {
    const target = page.locator(locator).first();
    if (await target.count()) {
      await target.click();
      log(`clicked ${label} using selector: ${locator}`);
      return true;
    }
  }
  return false;
}

async function hoverMetric(page, text) {
  const loc = page.getByText(new RegExp(`^${text}$`, "i")).first();
  if (await loc.count()) {
    await loc.hover();
    return true;
  }
  return false;
}

async function waitForRunsOrAuthRedirect(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = page.url();
    if (/\/runs(\/.*)?(\?.*)?$/.test(current)) {
      return;
    }
    if (/\/login(\/.*)?(\?.*)?$/.test(current)) {
      throw new Error(
        "Redirected to /login before reaching /runs. This target requires an authenticated session. " +
          "Set SESSION_COOKIE for this script or use a public demo URL.",
      );
    }
    await page.waitForTimeout(300);
  }

  throw new Error(`Timed out waiting for /runs. Last URL: ${page.url()}`);
}

async function ensureComparisonResultPage(page, timeoutMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const current = page.url();
    if (/\/runs\/compare\/[^/]+\/[^/]+(\?.*)?$/.test(current)) {
      return;
    }

    if (/\/runs\/compare(\?.*)?$/.test(current)) {
      const compareRunsButton = page.locator('button:has-text("Compare runs")').first();
      if (await compareRunsButton.count()) {
        const disabled = await compareRunsButton.isDisabled();
        if (disabled) {
          throw new Error(
            "Reached compare selector but Compare runs is disabled. Need at least two different runs to continue.",
          );
        }
        await compareRunsButton.click();
        await page.waitForTimeout(800);
      }
    }

    await page.waitForTimeout(300);
  }

  throw new Error(`Timed out waiting for comparison result page. Last URL: ${page.url()}`);
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: SLOW_MO });
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await context.newPage();

  const checks = {
    runCreated: false,
    traceVisible: false,
    failureHighlighted: false,
    insightsOpened: false,
    comparisonShown: false,
  };

  try {
    const startUrl = new URL(BASE_URL);

    if (SESSION_COOKIE) {
      await context.addCookies([
        {
          name: SESSION_COOKIE_NAME,
          value: SESSION_COOKIE,
          domain: startUrl.hostname,
          path: "/",
          httpOnly: false,
          secure: startUrl.protocol === "https:",
          sameSite: "Lax",
        },
      ]);
      log(`applied session cookie ${SESSION_COOKIE_NAME} for ${startUrl.hostname}`);
    }

    log(`scene 1: open app -> ${startUrl.toString()}`);
    await page.goto(startUrl.toString(), { waitUntil: "domcontentloaded" });
    await waitMs(page, 2000);
    await stepDelay(page);

    log("scene 2: run demo");
    const clickedRunDemo = await safeClick(page, "Run Demo", [
      '[data-testid="run-demo-button"]',
      'button:has-text("Run Demo")',
      'a:has-text("Run Demo")',
      'button:has-text("Run the demo")',
      'a:has-text("Run the demo")',
      'button:has-text("Run the demo in 60 seconds")',
      'a:has-text("Run the demo in 60 seconds")',
      'a:has-text("Watch 90-Second Product Tour")',
      'a[href="/demo"]',
      'a:has-text("Open runs")',
    ]);
    if (!clickedRunDemo) {
      throw new Error("Could not find a Run Demo trigger on the page.");
    }
    await waitMs(page, 4000);
    await stepDelay(page);

    if (/\/demo(\/.*)?(\?.*)?$/.test(page.url())) {
      log("detected demo page, opening runs");
      const openedRunsFromDemo = await safeClick(page, "Open runs", [
        'a:has-text("Open runs")',
        'a[href="/runs"]',
      ]);
      if (!openedRunsFromDemo) {
        throw new Error("Reached demo page but could not find Open runs link.");
      }
      await waitMs(page, 3000);
      await stepDelay(page);
    }

    log("scene 3: wait for runs page");
    await waitForRunsOrAuthRedirect(page, 30000);
    await waitMs(page, 2000);
    await stepDelay(page);
    checks.runCreated = true;

    log("scene 4: open latest run");
    const openedRun = await safeClick(page, "latest run", [
      '[data-testid="run-item"]:first-child a',
      '[data-testid="run-item"]:first-child',
      'tbody tr:first-child a[href*="/runs/"]',
    ]);
    if (!openedRun) {
      throw new Error("Could not open latest run from runs list.");
    }
    await waitMs(page, 3000);
    await stepDelay(page);

    log("scene 5: focus on spans");
    const focusedSpan = await safeClick(page, "first span", [
      '[data-testid="span-item"]:first-child',
      'text=Span Timeline',
    ]);
    if (!focusedSpan) {
      throw new Error("Could not focus a span.");
    }
    await waitMs(page, 2000);
    await stepDelay(page);
    checks.traceVisible = true;

    log("scene 6: highlight failure text invalid json");
    const invalidJson = page.getByText(/invalid json/i).first();
    if (await invalidJson.count()) {
      await invalidJson.scrollIntoViewIfNeeded();
      await invalidJson.click();
      checks.failureHighlighted = true;
      log('found and clicked failure marker text: "invalid json"');
    } else {
      log('failure marker "invalid json" not found; continuing flow');
    }
    await waitMs(page, 3000);
    await stepDelay(page);

    log("scene 7: open insights");
    const openedInsights = await safeClick(page, "Insights", [
      'button:has-text("Insights")',
      'a:has-text("Insights")',
      '[data-testid="insights-panel"]',
    ]);
    if (openedInsights) {
      checks.insightsOpened = true;
    }
    await waitMs(page, 4000);
    await stepDelay(page);

    log("scene 8: scroll insights");
    await page.mouse.wheel(0, 500);
    await waitMs(page, 2000);
    await stepDelay(page);
    await page.mouse.wheel(0, 500);
    await waitMs(page, 2000);
    await stepDelay(page);

    log("scene 9: open comparison");
    const openedCompare = await safeClick(page, "Compare", [
      '[data-testid="compare-button"]',
      'button:has-text("Compare")',
      'a:has-text("Compare")',
      'a[href*="compare"]',
    ]);
    if (!openedCompare) {
      const directCompareUrl = new URL("/runs/compare", page.url()).toString();
      log(`compare trigger not found, navigating directly to ${directCompareUrl}`);
      await page.goto(directCompareUrl, { waitUntil: "domcontentloaded" });
    }
    await waitMs(page, 3000);
    await stepDelay(page);
    await ensureComparisonResultPage(page, 30000);
    checks.comparisonShown = /\/runs\/compare\/[^/]+\/[^/]+/.test(page.url());

    log("scene 10: highlight metrics");
    await hoverMetric(page, "Latency");
    await waitMs(page, 1500);
    await stepDelay(page);
    await hoverMetric(page, "Token Usage");
    await waitMs(page, 1500);
    await stepDelay(page);
    await hoverMetric(page, "Estimated Cost");
    await waitMs(page, 2000);
    await stepDelay(page);

    log("scene 11: show prompt diff");
    const promptDiffsHeading = page.getByText(/Prompt Diffs/i).first();
    if (await promptDiffsHeading.count()) {
      await promptDiffsHeading.scrollIntoViewIfNeeded();
    }
    await waitMs(page, 2000);
    await stepDelay(page);

    log("scene 12: final pause");
    await waitMs(page, 5000);

    const result = {
      "run created": checks.runCreated,
      "trace visible": checks.traceVisible,
      "failure highlighted": checks.failureHighlighted,
      "insights opened": checks.insightsOpened,
      "comparison shown": checks.comparisonShown,
    };

    console.log("\nExpected Output:");
    for (const [name, ok] of Object.entries(result)) {
      console.log(`- ${name}: ${ok ? "yes" : "no"}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("\nProduct tour script failed:");
  console.error(error);
  process.exitCode = 1;
});
