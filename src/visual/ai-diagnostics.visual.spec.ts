/**
 * Real-browser E2E for the AI Diagnostics modal (diagnostics task 5.2).
 *
 * Exercises the production modal, smoke runner, feature summaries and redacted
 * export in a plain browser with deterministic fixtures:
 *   open idle (no run) → inspect blockers → run selected → Stop → retry →
 *   scoped result → export/download → reload to unknown.
 *
 * Run: npx playwright test src/visual/ai-diagnostics.visual.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const HARNESS = "/ai-diagnostics-harness.html";

async function openHarness(page: Page) {
  await page.goto(HARNESS, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "AI Diagnostics & Hardware Capabilities" })
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Learning Feature Readiness & Evidence")).toBeVisible();
}

test.describe("AI diagnostics modal", () => {
  test("is idle on open, runs/stops a bounded fixture, retries, and exports a redacted report", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await openHarness(page);

    // Idle: blockers are visible and nothing has run.
    await expect(page.getByText("Setup required").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Run selected/ })).toBeDisabled();
    await expect(page.getByText("No execution observed this session").first()).toBeVisible();

    // Select the fixture case and stop the slow run.
    await page.getByRole("combobox").selectOption("learn-this");
    await page.getByRole("button", { name: /Run selected/ }).click();
    await expect(page.getByRole("button", { name: /Stop/ })).toBeEnabled();
    await page.getByRole("button", { name: /Stop/ }).click();
    await expect(
      page.locator('[data-smoke-feature="learn-this"][data-smoke-state="cancelled"]')
    ).toBeVisible({ timeout: 10_000 });

    // Retry to completion.
    await page.getByRole("button", { name: /Run selected/ }).click();
    await expect(
      page.locator('[data-smoke-feature="learn-this"][data-smoke-state="passed"]')
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/preview, persistence \(unverified\)/)).toBeVisible();

    // Explicit export preview: schema-versioned, no canary.
    await page.getByRole("button", { name: "Redacted report preview" }).click();
    const preview = page.locator("pre");
    await expect(preview).toContainText("ai-diagnostics-report-v1");
    await expect(preview).toContainText('"scope": "session"');
    const previewText = (await preview.textContent()) ?? "";
    expect(previewText).not.toContain("sk-live-CANARY-51H8");
    expect(previewText).not.toContain("private-chunk-id");
    expect(previewText).not.toContain("private-model-path");

    // Download is explicit and local.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download report" }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const report = JSON.parse(readFileSync(path!, "utf8"));
    expect(report.schemaVersion).toBe("ai-diagnostics-report-v1");
    expect(report.scope).toBe("session");
    expect(JSON.stringify(report)).not.toContain("sk-live-CANARY-51H8");

    // No unexpected external destination was contacted.
    for (const url of requests) {
      expect(url.startsWith("http://localhost:5199") || url.startsWith("data:") || url.startsWith("blob:")).toBe(
        true
      );
    }

    // Restart: session-local history is unknown, never a stale pass.
    await page.reload({ timeout: 30_000 });
    await expect(
      page.getByRole("heading", { name: "AI Diagnostics & Hardware Capabilities" })
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("No execution observed this session").first()).toBeVisible();
  });
});
