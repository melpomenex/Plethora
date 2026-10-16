import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`palette actions produce real outcomes at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/palette-actions-harness.html");
    const open = async () => {
      await page.getByRole("button", { name: "Open commands" }).click();
      await expect(page.getByRole("combobox", { name: "Search, ask, or run a command" })).toBeVisible();
    };
    await open();
    await page.getByRole("combobox", { name: "Search, ask, or run a command" }).fill("Manage Queues");
    await page.getByRole("option").filter({ hasText: "Manage Queues" }).first().click();
    const manager = page.getByRole("dialog");
    await expect(manager).toContainText("Quick Review");
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.screenshot({ path: `.playwright/results/palette-actions-manager-${viewport.width}.png` });
    await manager.getByRole("button", { name: "Done" }).click();

    await page.getByRole("button", { name: "Document", exact: true }).click();
    await open();
    await page.getByRole("tab", { name: "Actions", exact: true }).click();
    await page.getByRole("option").filter({ hasText: "New Queue" }).first().click();
    await expect(page.getByRole("dialog")).toContainText("Customize Session");
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

    await open();
    await page.getByRole("button", { name: "View all", exact: true }).click();
    await page.getByRole("combobox", { name: "Search, ask, or run a command" }).fill("Quick Review");
    await page.getByRole("option").filter({ hasText: "Quick Review" }).first().click();
    await expect(page.getByText("Eligible study card", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Excluded reading item", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `.playwright/results/palette-actions-quick-review-${viewport.width}.png` });
    await open();
    await page.getByRole("combobox", { name: "Search, ask, or run a command" }).fill("Start Optimal Session");
    await page.getByRole("option").filter({ hasText: "Start Optimal Session" }).first().click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { paletteActionSession: () => unknown }).paletteActionSession())).toMatchObject({
      customQueueItems: [{ id: "eligible" }], itemTypes: { documents: false, extracts: false, learningItems: true }, queueScrollMode: "queue-list",
    });


    await page.getByRole("button", { name: "Document", exact: true }).click();
    await open();
    await page.getByRole("combobox", { name: "Search, ask, or run a command" }).fill("Translate selection");
    await expect(page.getByRole("option").filter({ hasText: /Translate selection/i }).first()).toBeVisible();
    await page.getByRole("combobox", { name: "Search, ask, or run a command" }).press("Enter");
    await expect(page.getByRole("dialog")).toContainText("Bonjour. Comment allez-vous ?");
    await page.getByLabel("Source language").fill("fr");
    await page.getByLabel("Translate into").fill("en");
    await page.getByRole("button", { name: /Translate selection/i }).click();
    await expect(page.getByRole("alert")).toContainText(/model|provider|language/i);
    await page.screenshot({ path: `.playwright/results/palette-actions-translation-${viewport.width}.png` });
  });
}
