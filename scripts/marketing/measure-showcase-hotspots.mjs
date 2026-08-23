#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { stableJson } from "./compile-fixture-v2.mjs";
import { measureSceneHotspots } from "./capture-hotspots.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT = join(ROOT, "marketing/generated/showcase-hotspots-v2.json");
const captureUrl = process.env.MARKETING_CAPTURE_URL;
if (!captureUrl) throw new Error("MARKETING_CAPTURE_URL is required");

const catalog = JSON.parse(await readFile(join(ROOT, "marketing/generated/showcase-scenes-v2.json"), "utf8"));
const measurements = [];
const systemChromium = "/Applications/Chromium.app/Contents/MacOS/Chromium";
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync(systemChromium) ? systemChromium : undefined);
const browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable });
try {
  for (const scene of catalog.scenes.filter((entry) => entry.captureSupported)) {
    for (const layout of scene.layouts.filter((entry) => entry.required)) {
      const { width, height, dpr } = layout.viewport;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: dpr,
        locale: catalog.metadata.locale,
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("plethora-onboarding-tour-optout", "1");
      });
      const target = new URL(captureUrl);
      target.hash = `#/?fixture=${encodeURIComponent(catalog.metadata.fixtureId)}&scene=${encodeURIComponent(scene.id)}&layout=${encodeURIComponent(layout.layout)}`;
      await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector("body[data-marketing-state-applied=\"true\"]", { timeout: 45_000, state: "attached" });
      const hotspots = await measureSceneHotspots(page, scene, { width, height });
      measurements.push({ sceneId: scene.id, layout: layout.layout, viewport: layout.viewport, hotspots });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const output = {
  metadata: {
    schemaVersion: 1,
    catalogId: catalog.metadata.catalogId,
    fixtureId: catalog.metadata.fixtureId,
    fixtureVersion: catalog.metadata.fixtureVersion,
    fixtureHash: catalog.metadata.fixtureHash,
    source: "playwright-dom-measurement",
  },
  measurements,
};
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, stableJson(output), "utf8");
console.log(`Measured ${measurements.reduce((sum, entry) => sum + entry.hotspots.length, 0)} hotspots across ${measurements.length} scene layouts`);
