#!/usr/bin/env node
/**
 * Capture marketing stills. Tries Playwright against a seeded web UI when
 * MARKETING_CAPTURE_URL is set. Otherwise writes labeled placeholders.
 *
 * Does not touch src/visual/__snapshots__. Does not use in-app screenshot.rs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeProductImages } from "./encode-product-images.mjs";
import { writePlaceholderPngs } from "./generate-placeholders.mjs";
import { CAPTURE_SPECS, sourcePngName } from "./surfaces.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_DIR = join(ROOT, "marketing/screenshots/source");

async function tryPlaywrightCaptures() {
  const url = process.env.MARKETING_CAPTURE_URL;
  if (!url) {
    return { captured: [], reason: "MARKETING_CAPTURE_URL unset; Tauri/PWA not driven in this environment." };
  }
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    return { captured: [], reason: "Playwright not importable." };
  }
  mkdirSync(SOURCE_DIR, { recursive: true });
  const captured = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const spec of CAPTURE_SPECS) {
      if (spec.kind === "og") continue;
      const context = await browser.newContext({
        viewport: { width: spec.width, height: spec.height },
        colorScheme: spec.theme === "dark" ? "dark" : "light",
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        sessionStorage.setItem("__sw_cleared__", "1");
        localStorage.setItem("plethora-onboarding-tour-optout", "1");
        document.documentElement.style.setProperty(
          "--font-family",
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        );
      });
      if (spec.theme === "eink") {
        await page.addInitScript(() => {
          localStorage.setItem("plethora-display-mode", "eink");
        });
      }
      const target = new URL(url);
      target.searchParams.set("marketing-capture", spec.surface);
      if (process.env.MARKETING_SEED === "1") {
        target.searchParams.set("marketing-seed", "1");
      }
      target.hash = "#/";
      try {
        await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.addStyleTag({ content: ".kp-overlay, #boot-frame { display: none !important; }" });
        await page.waitForSelector('body[data-marketing-ready="1"]', { timeout: 45_000, state: "attached" });
        await page.waitForTimeout(900);
        const file = join(SOURCE_DIR, sourcePngName(spec));
        await page.screenshot({ path: file, fullPage: false });
        captured.push(file);
      } catch (error) {
        console.warn(`Playwright missed ${spec.id}: ${error.message}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return { captured, reason: captured.length ? "playwright" : "navigation failed" };
}

const result = await tryPlaywrightCaptures();
if (result.captured.length === 0) {
  console.warn(`Using labeled placeholders (${result.reason})`);
  await writePlaceholderPngs();
} else {
  console.log(`Captured ${result.captured.length} stills via Playwright`);
}
const encoded = await encodeProductImages();
writeFileSync(
  join(SOURCE_DIR, "CAPTURE_LOG.md"),
  `# Capture log

- when: 2026-08-23
- playwright: ${result.captured.length ? "partial/real" : "not used for committed files"}
- reason: ${result.reason}
- placeholders: committed source PNGs are labeled PLACEHOLDER art unless replaced
- snapshots: \`src/visual/__snapshots__\` was not modified
`,
);
console.log(encoded.marketingPath);
