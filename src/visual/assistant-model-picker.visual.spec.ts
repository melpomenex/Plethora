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

function harnessUrl(options: { detent?: string; text?: string | null }) {
  const params = new URLSearchParams();
  if (options.detent) params.set("detent", options.detent);
  if (options.text) params.set("text", options.text);
  const query = params.toString();
  return `${HARNESS}${query ? `?${query}` : ""}`;
}

async function openPicker(page: Page, options: { detent?: string; text?: string | null }) {
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
});

async function expectDesktopBounds(page: Page) {
  const picker = page.locator("[data-assistant-model-picker]");
  const trigger = page.getByTitle("Change Active AI Model");
  const value = await geometry(page);
  expectContained(value);
  const menu = await picker.locator("..").boundingBox();
  const control = await trigger.boundingBox();
  expect(menu!.y).toBeGreaterThanOrEqual(control!.y + control!.height);
  expect(menu!.y).toBeGreaterThanOrEqual(0);
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(menu!.x).toBeGreaterThanOrEqual(Math.max(0, value.sheet.left) - 1);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width, value.sheet.right) + 1);
  await expect(picker.getByRole("heading")).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Manage AI providers" })).toBeInViewport({ ratio: 1 });
}

async function expectRowInList(page: Page, selector: string) {
  const list = page.locator("[data-assistant-model-list]");
  const row = page.locator(selector);
  const rowBox = await row.boundingBox();
  const listBox = await list.boundingBox();
  expect(rowBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height + 1);
}

// Desktop uses the actual AssistantPanel; a separate positioned approximation
// cannot reproduce flex static-position regressions in the toolbar.
test.describe("production desktop provider picker", () => {
  test("reflows while open after panel, viewport, and scale changes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/assistant-controls-harness.html?picker&width=420&side=right");
    await page.getByTitle("Change Active AI Model").click();
    const menu = page.locator("[data-assistant-model-menu]");
    await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    for (const layout of [
      { width: 1024, height: 600, panel: 320, scale: 1.5 },
      { width: 900, height: 360, panel: 420, scale: 1 },
      { width: 1280, height: 720, panel: 320, scale: 0.7 },
    ]) {
      await page.setViewportSize({ width: layout.width, height: layout.height });
      await page.evaluate(({ panel, scale }) => {
        document.documentElement.style.zoom = String(scale);
        document.documentElement.style.setProperty("--harness-viewport-height", `${innerHeight / scale}px`);
        (document.querySelector("[data-harness-sheet]") as HTMLElement).style.width = `${panel}px`;
        return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }, layout);
      await expectDesktopBounds(page);
      const list = page.locator("[data-assistant-model-list]");
      await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      await expectRowInList(page, "[data-assistant-provider-option]:last-child");
    }
  });

  for (const side of ["left", "right"]) {
    for (const panelWidth of [320, 420]) {
      for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }]) {
        for (const zoom of [0.7, 1, 1.5]) {
          test(`${side} ${panelWidth}px ${viewport.width}x${viewport.height} scale ${zoom}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            const active = panelWidth === 320 ? "deepseek" : "openai";
            await page.goto(`/assistant-controls-harness.html?picker&width=${panelWidth}&side=${side}&active=${active}&theme=legal-pad`);
            const trigger = page.getByTitle("Change Active AI Model");
            await expect(trigger).toBeVisible({ timeout: 30_000 });
            // CSS scale exercises conversion between viewport rectangles and
            // local lengths; native WebView zoom still needs a platform check.
            await page.evaluate((scale) => {
              // WebView zoom changes the layout viewport as well as scale.
              // Compensate this fixed-height fixture to model the same space.
              document.documentElement.style.setProperty("--harness-viewport-height", `${innerHeight / scale}px`);
              document.documentElement.style.zoom = String(scale);
              document.querySelector("[data-harness-reader]")!.scrollTop = 80;
            }, zoom);
            const input = page.getByRole("textbox");
            await input.fill("Keep this unsent draft");
            const scrollOffsets = () => page.evaluate(() => [
              document.scrollingElement!.scrollTop,
              document.querySelector("[data-harness-sheet]")!.scrollTop,
              document.querySelector("[data-harness-sheet] > div")!.scrollTop,
              document.querySelector("[data-harness-reader]")!.scrollTop,
            ]);
            const before = await scrollOffsets();
            await trigger.click();
            const picker = page.locator("[data-assistant-model-picker]");
            await expect(picker).toBeVisible();
            // Wait for the existing entrance animation before measuring.
            await picker.evaluate((element) => Promise.all(element.parentElement!.getAnimations().map((animation) => animation.finished)));

            await expectDesktopBounds(page);
            const list = page.locator("[data-assistant-model-list]");

            await expectRowInList(page, '[data-assistant-provider-option][aria-pressed="true"]');
            await list.evaluate((element) => { element.scrollTop = 0; });
            await expectRowInList(page, '[data-assistant-provider-option]:first-child');
            await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
            await expectRowInList(page, '[data-assistant-provider-option]:last-child');
            await expectDesktopBounds(page);
            expect(await scrollOffsets()).toEqual(before);
            await page.screenshot({ path: `${RESULTS_DIR}/desktop-picker-${side}-${panelWidth}-${viewport.height}-${zoom}.png`, animations: "disabled" });
            await page.keyboard.press("Escape");
            await expect(picker).toHaveCount(0);
            await expect(trigger).toBeFocused();
            await expect(input).toHaveValue("Keep this unsent draft");
            expect(await scrollOffsets()).toEqual(before);
          });
        }
      }
    }
  }
});
