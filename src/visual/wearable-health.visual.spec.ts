import { expect, test } from "@playwright/test";

const harness = "/src/visual/entries/wearable-health-harness.html";

test("logs sleep, inspects provenance and evidence, connects, disconnects, and wipes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1240, height: 900 });
  await page.goto(harness);
  await expect(page.getByRole("heading", { name: "Start with a night of sleep" })).toBeVisible();
  await page.getByRole("button", { name: "Log sleep" }).first().click();
  const form = page.getByRole("dialog", { name: "Log sleep" });
  await form.getByLabel("Sleep started").fill("2026-11-18T23:00");
  await form.getByLabel("Woke up").fill("2026-11-19T07:00");
  await form.getByLabel("Notes (optional)").fill("Test sleep note");
  await form.getByRole("button", { name: "Save sleep" }).click();
  await expect(page.getByRole("heading", { name: "Sleep summary" })).toBeVisible();

  await page.getByRole("button", { name: "Open Sleep Chart" }).click();
  await expect(page.getByText(/Sources disagree/)).toBeVisible();
  await expect(page.getByText(/coverage is below 70%/)).toBeVisible();
  await page.getByText("Sources", { exact: true }).click();
  await expect(page.getByText(/manual · primary/)).toBeVisible();
  await expect(page.locator(".health-mark-deep")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit entry" }).click();
  const edit = page.getByRole("dialog", { name: "Edit sleep" });
  await expect(edit.getByLabel("Notes (optional)")).toHaveValue("Test sleep note");
  await edit.getByRole("button", { name: "Cancel" }).click();
  await page.screenshot({ path: testInfo.outputPath("desktop-light-sleep.png"), fullPage: true });

  await page.getByRole("button", { name: "Learning Performance" }).click();
  await expect(page.getByRole("heading", { name: "Review performance" })).toBeVisible();
  await page.getByLabel("Study Plan").selectOption("biology");
  await expect(page.getByRole("heading", { name: "Learning Windows" })).toBeVisible();
  await page.getByRole("button", { name: "Personal Patterns" }).click();
  await page.getByRole("button", { name: "Inspect evidence" }).click();
  await expect(page.getByRole("dialog", { name: "Biology recall and sleep" })).toContainText("120");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Data Sources", exact: true }).click();
  await expect(page.getByText(/sign-in service is offline/)).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "Connect Health Connect" });
  await consent.getByRole("button", { name: "Continue" }).click();
  await expect(consent.getByRole("checkbox", { name: "Sleep times" })).toBeChecked();
  await expect(consent.getByRole("checkbox", { name: "Heart rate" })).not.toBeChecked();
  await consent.getByRole("button", { name: "Authorize" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect provider" }).click();
  await expect(page.getByText(/Imported records are still available/)).toBeVisible();
  await page.getByRole("button", { name: "Delete all health data" }).click();
  const wipe = page.getByRole("dialog", { name: "Delete all health data?" });
  await expect(wipe.getByRole("button", { name: "Cancel" })).toBeFocused();
  await wipe.getByRole("button", { name: "Delete data", exact: true }).click();
  await page.getByRole("button", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Start with a night of sleep" })).toBeVisible();
});

test("handles denied access and staged sample data in a narrow dark layout", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${harness}?theme=dark&denied`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Explore sample data" }).click();
  await expect(page.getByText("Sample data.")).toBeVisible();
  await page.getByRole("button", { name: "Sleep Chart", exact: true }).click();
  await expect(page.locator(".health-mark-deep")).toBeVisible();
  await expect(page.locator(".health-mark-rem")).toBeVisible();
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return { width, scrollWidth: document.documentElement.scrollWidth, offenders: Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.getBoundingClientRect().right > width + 1).slice(0, 8).map((element) => element.outerHTML.slice(0, 140)) };
  });
  expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBe(overflow.width);
  await page.screenshot({ path: testInfo.outputPath("mobile-dark-sample.png"), fullPage: true });
  await page.getByRole("button", { name: "Exit sample data" }).click();
  await page.getByRole("button", { name: "Data Sources", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "Connect Health Connect" });
  await consent.getByRole("button", { name: "Continue" }).click();
  await consent.getByRole("button", { name: "Authorize" }).click();
  await expect(consent.getByRole("alert")).toContainText("permission was denied");
});

test("web clients show the native availability message", async ({ page }) => {
  await page.goto(`${harness}?web`);
  await expect(page.getByRole("heading", { name: "Health Vault is available in the native app" })).toBeVisible();
});
