import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const screenshots = ".playwright/results/section-picker";
mkdirSync(screenshots, { recursive: true });

async function expectPickerVisible(page: Page, hostSelector: string, name: string) {
  const list = page.getByRole("listbox", { name: "Sections" });
  await expect(list).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-section-picker-option]").first()).toBeVisible();

  const box = await list.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();

  // Nothing pushes the list outside the visible viewport.
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);

  const host = await page.locator(hostSelector).boundingBox();
  if (host) {
    expect(box!.x).toBeGreaterThanOrEqual(host.x - 1);
    expect(box!.y).toBeGreaterThanOrEqual(host.y - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(host.x + host.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(host.y + host.height + 1);
  }

  // The actual clip test: a painted point inside the first row must resolve
  // to the picker. If an ancestor's overflow clips the portaled layer, this
  // returns the element underneath instead.
  const option = await page.locator("[data-section-picker-option]").first().boundingBox();
  expect(option).not.toBeNull();
  const hitInsidePicker = await page.evaluate(
    ({ x, y }) =>
      Boolean(document.elementFromPoint(x, y)?.closest("[data-section-picker]")),
    { x: option!.x + option!.width / 2, y: option!.y + option!.height / 2 },
  );
  expect(hitInsidePicker).toBe(true);

  await page.screenshot({ path: `${screenshots}/${name}.png` });
}

test("desktop assistant: # picker is unclipped and expands the outline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/assistant-controls-harness.html?width=420&sections");

  const input = page.getByRole("textbox").first();
  await input.click();
  await input.fill("#");

  await expectPickerVisible(page, "[data-harness-sheet]", "desktop-assistant");
  await expect(input).toBeFocused();

  // The outline starts at top level and a disclosure reveals the chapter.
  await expect(page.getByRole("listbox").getByText("Part One", { exact: true })).toBeVisible();
  await expect(page.getByRole("listbox").getByText("Chapter 1", { exact: true })).toHaveCount(0);
  await page.locator("[data-section-picker-option]").first().locator("button").click();
  await expect(page.getByRole("listbox").getByText("Chapter 1", { exact: true })).toBeVisible();
  await expect(input).toBeFocused();

  // The floating layer follows layout changes instead of being left behind.
  await page.setViewportSize({ width: 1100, height: 720 });
  await expectPickerVisible(page, "[data-harness-sheet]", "desktop-assistant-resized");
});

test("mobile assistant sheet: # picker stays anchored and visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant-controls-harness.html?mobile&sections");

  const input = page.getByRole("textbox").first();
  await input.click();
  await input.fill("#");

  await expectPickerVisible(page, "[data-harness-sheet]", "mobile-assistant");
});

test("document QA: # picker is unclipped above the question box", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/src/visual/fixtures/document-qa.html?sectionPicker");

  const input = page.getByRole("textbox", { name: "Your question" });
  await input.click();
  await input.fill("#");

  await expectPickerVisible(page, ".document-qa-workspace", "document-qa");
  await expect(page.getByRole("listbox").getByText("Part One", { exact: true })).toBeVisible();
});
