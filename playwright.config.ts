import { defineConfig } from "@playwright/test";

/**
 * Visual regression for PDF reflow (task 10.2, change add-pdf-reflow).
 *
 * Screenshots the reflow view of representative fixtures at phone, tablet,
 * and desktop pane sizes against committed baselines. Warn-only posture
 * until baselines stabilize (same rollout as the perf gate): a missing
 * baseline writes one; CI uploads the artifact.
 *
 * Run:  npm run test:visual
 * Browsers are installed on demand:  npx playwright install chromium
 */
export default defineConfig({
  testDir: "./src/visual",
  outputDir: "./.playwright/results",
  snapshotDir: "./src/visual/__snapshots__",
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{arg}{ext}",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:5199",
    headless: true,
    viewport: { width: 390, height: 844 },
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
