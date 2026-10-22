import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const screenshots = ".playwright/results/assistant-controls";
mkdirSync(screenshots, { recursive: true });

const layouts = [
  { name: "desktop-light", width: 1280, height: 800, query: "width=420" },
  { name: "desktop-min-dark", width: 1280, height: 800, query: "width=300&theme=obsidian-noir" },
  { name: "desktop-legal-pad", width: 1280, height: 800, query: "width=420&theme=legal-pad" },
  { name: "mobile-expanded", width: 390, height: 844, query: "mobile" },
  { name: "mobile-partial-keyboard", width: 390, height: 844, query: "mobile&partial&keyboard" },
  { name: "mobile-expanded-keyboard", width: 320, height: 740, query: "mobile&keyboard" },
  { name: "mobile-french-200", width: 390, height: 844, query: "mobile&locale=fr&zoom" },
];

for (const layout of layouts) {
  test(`${layout.name}: mode and source hierarchy, containment, and continuity`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(`/assistant-controls-harness.html?${layout.query}`);
    const source = page.locator("[data-assistant-answer-from] > button");
    await expect(source).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-assistant-toolbar] [data-assistant-answer-from]")).toHaveCount(0);
    await expect(page.locator("[data-assistant-mode-toggle]")).toHaveCount(1);
    const input = page.getByRole("textbox");
    await input.fill("Keep this unsent draft");
    await source.click();
    const menu = page.getByRole("menu", { name: layout.query.includes("fr") ? "Répondre à partir de" : "Answer from" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
    const menuBox = await menu.boundingBox();
    const sheetBox = await page.locator("[data-harness-sheet]").boundingBox();
    expect(menuBox!.x).toBeGreaterThanOrEqual(sheetBox!.x - 1);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width + 1);
    expect(menuBox!.y).toBeGreaterThanOrEqual(sheetBox!.y - 1);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height + 1);
    await page.screenshot({ path: `${screenshots}/${layout.name}-sources.png` });
    // Selecting the last option must work even when the list needs scrolling.
    await menu.getByRole("menuitemradio").last().click();
    await expect(source).toBeFocused();
    await expect(source).toContainText(layout.query.includes("fr") ? "Ma bibliothèque" : "My library");
    await source.click();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await source.click();
    expect(await page.evaluate(() => window.assistantControlsFixture.back())).toBe(true);
    await expect(menu).toHaveCount(0);
    await expect(page.locator("[data-harness-sheet]")).toBeVisible();
    await expect(input).toHaveValue("Keep this unsent draft");
    expect((await input.boundingBox())!.width).toBeGreaterThan(120);
    await page.evaluate(() => window.assistantControlsFixture.openAgent());
    await expect(page.locator("[data-learning-agent-composer]")).toBeVisible();
    await expect(source).toHaveCount(0);
    await page.screenshot({ path: `${screenshots}/${layout.name}-agent.png` });
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(source).toContainText(layout.query.includes("fr") ? "Ma bibliothèque" : "My library");
    await expect(input).toHaveValue("Keep this unsent draft");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(source).toBeInViewport();
  });
}
