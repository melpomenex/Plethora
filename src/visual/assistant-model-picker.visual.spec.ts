/**
 * Real-browser containment and scroll checks for the AI-engine picker.
 *
 * The reported defect: on a phone the provider menu drew past the sheet and
 * could not be scrolled, so lower providers were unreachable. The harness
 * renders the REAL `AssistantModelPicker` in a sheet-shaped flex column with
 * eight providers (see `assistantModelPickerHarness.tsx`).
 *
 * Run: npx playwright test src/visual/assistant-model-picker.visual.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const HARNESS = "/assistant-model-picker-harness.html";
const RESULTS_DIR = ".playwright/results";
mkdirSync(RESULTS_DIR, { recursive: true });

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface FrameGeometry {
  sheet: Rect;
  picker: Rect;
  list: Rect;
  rows: Rect[];
  listScrollHeight: number;
  listClientHeight: number;
  documentScrollWidth: number;
  viewportWidth: number;
}

const PHONE_VIEWPORTS = [
  { name: "320x568-expanded", width: 320, height: 568, detent: "expanded", text: null },
  { name: "320x568-partial", width: 320, height: 568, detent: "partial", text: null },
  { name: "360x844", width: 360, height: 844, detent: "expanded", text: null },
  { name: "390x844", width: 390, height: 844, detent: "expanded", text: null },
  { name: "430x932", width: 430, height: 932, detent: "expanded", text: null },
  { name: "landscape-844x390", width: 844, height: 390, detent: "expanded", text: null },
  { name: "390x844-text200", width: 390, height: 844, detent: "expanded", text: "200" },
];

function harnessUrl(options: { variant?: "mobile" | "desktop"; detent?: string; text?: string | null }) {
  const params = new URLSearchParams();
  if (options.variant === "desktop") params.set("variant", "desktop");
  if (options.detent) params.set("detent", options.detent);
  if (options.text) params.set("text", options.text);
  const query = params.toString();
  return `${HARNESS}${query ? `?${query}` : ""}`;
}

async function openPicker(page: Page, options: { variant?: "mobile" | "desktop"; detent?: string; text?: string | null }) {
  await page.goto(harnessUrl(options), { timeout: 30_000 });
  await expect(page.locator("[data-assistant-model-picker]")).toBeVisible({ timeout: 20_000 });
}

async function geometry(page: Page): Promise<FrameGeometry> {
  return page.evaluate(() => {
    const rect = (element: Element): Rect => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const sheet = document.querySelector("[data-harness-sheet]")!;
    const picker = document.querySelector("[data-assistant-model-picker]")!;
    const list = document.querySelector("[data-assistant-model-list]") as HTMLElement;
    return {
      sheet: rect(sheet),
      picker: rect(picker),
      list: rect(list),
      rows: Array.from(document.querySelectorAll("[data-assistant-provider-option]")).map(rect),
      listScrollHeight: list.scrollHeight,
      listClientHeight: list.clientHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
}

function expectContained(geometry: FrameGeometry) {
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.picker.left).toBeGreaterThanOrEqual(geometry.sheet.left - 1);
  expect(geometry.picker.right).toBeLessThanOrEqual(geometry.sheet.right + 1);
  expect(geometry.picker.top).toBeGreaterThanOrEqual(geometry.sheet.top - 1);
  expect(geometry.picker.bottom).toBeLessThanOrEqual(geometry.sheet.bottom + 1);
  expect(geometry.list.left).toBeGreaterThanOrEqual(geometry.picker.left - 1);
  expect(geometry.list.right).toBeLessThanOrEqual(geometry.picker.right + 1);
  expect(geometry.list.bottom).toBeLessThanOrEqual(geometry.picker.bottom + 1);
  expect(geometry.list.height).toBeGreaterThan(0);
  for (const row of geometry.rows) {
    expect(row.left).toBeGreaterThanOrEqual(geometry.list.left - 1);
    expect(row.right).toBeLessThanOrEqual(geometry.list.right + 1);
    expect(row.width).toBeGreaterThan(0);
  }
}

test.describe("assistant model picker containment", () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`keeps every provider reachable at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openPicker(page, { detent: viewport.detent, text: viewport.text });

      await expect(page.getByRole("button", { name: "Close model picker" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Manage AI providers" })).toBeVisible();
      await page.screenshot({ path: `${RESULTS_DIR}/assistant-model-picker-${viewport.name}.png` });

      const initial = await geometry(page);
      expectContained(initial);

      // Opening scrolls to the selected engine; it may not be clipped.
      const active = page.locator('[data-assistant-provider-option][aria-pressed="true"]');
      await expect(active).toBeVisible();
      const activeBox = await active.boundingBox();
      expect(activeBox).not.toBeNull();
      expect(activeBox!.y).toBeGreaterThanOrEqual(initial.list.top - 1);
      expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(initial.list.bottom + 2);

      const last = page.locator("[data-assistant-provider-option]").last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeVisible();

      const scrolled = await geometry(page);
      expectContained(scrolled);
      const lastRect = scrolled.rows[scrolled.rows.length - 1];
      expect(lastRect.top).toBeGreaterThanOrEqual(scrolled.list.top - 1);
      expect(lastRect.bottom).toBeLessThanOrEqual(scrolled.list.bottom + 2);
      expect(lastRect.bottom).toBeLessThanOrEqual(scrolled.sheet.bottom + 1);

      await last.click();
      await expect.poll(() => page.evaluate(() => window.__assistantModelPickerHarness?.lastSelected)).toBe("deepseek");
      await expect(last).toHaveAttribute("aria-pressed", "true");

      await page.getByRole("button", { name: "Close model picker" }).click();
      await expect(page.locator("[data-assistant-model-picker]")).toHaveCount(0);
      await expect(page.locator("[data-harness-reopen]")).toBeVisible();
      expect(await page.evaluate(() => window.__assistantModelPickerHarness?.closed)).toBe(1);
    });
  }

  test("opens settings from the picker without closing it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPicker(page, { detent: "expanded" });

    await page.getByRole("button", { name: "Manage AI providers" }).click();

    await expect(page.locator("[data-assistant-model-picker]")).toBeVisible();
    expect(await page.evaluate(() => window.__assistantModelPickerHarness?.settingsOpened)).toBe(1);
  });

  test("keeps the anchored desktop menu scrollable in a short pane", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 500 });
    await openPicker(page, { variant: "desktop" });

    const initial = await geometry(page);
    expectContained(initial);
    expect(initial.listScrollHeight).toBeGreaterThan(initial.listClientHeight);
    await expect(page.getByRole("button", { name: "Manage AI providers" })).toBeVisible();
    const active = page.locator('[data-assistant-provider-option][aria-pressed="true"]');
    await expect(active).toBeVisible();
    const activeBox = await active.boundingBox();
    expect(activeBox).not.toBeNull();
    expect(activeBox!.y).toBeGreaterThanOrEqual(initial.list.top - 1);
    expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(initial.list.bottom + 2);
    await page.screenshot({ path: `${RESULTS_DIR}/assistant-model-picker-desktop-360x500.png` });

    const last = page.locator("[data-assistant-provider-option]").last();
    await last.scrollIntoViewIfNeeded();
    const scrolled = await geometry(page);
    expectContained(scrolled);
    const lastRect = scrolled.rows[scrolled.rows.length - 1];
    expect(lastRect.top).toBeGreaterThanOrEqual(scrolled.list.top - 1);
    expect(lastRect.bottom).toBeLessThanOrEqual(scrolled.list.bottom + 2);

    await last.click();
    await expect.poll(() => page.evaluate(() => window.__assistantModelPickerHarness?.lastSelected)).toBe("deepseek");
  });
});
