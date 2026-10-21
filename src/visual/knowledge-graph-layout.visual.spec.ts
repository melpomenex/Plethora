/**
 * Real-browser layout guard for the Knowledge Graph workspace.
 *
 * The reported defect: on a phone the 288px filter sidebar consumed most of the
 * viewport and the fixed-height header clipped the page title. The harness
 * mounts the REAL header, filter sidebar/sheet, and canvas flex chain (see
 * `knowledgeGraphLayoutHarness.tsx`) so the measurements reflect the shipped
 * components rather than a copy.
 *
 * Run: npx playwright test src/visual/knowledge-graph-layout.visual.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const HARNESS = "/knowledge-graph-layout-harness.html";
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

interface LayoutMetrics {
  header: Rect;
  canvas: Rect;
  documentScrollWidth: number;
  viewportWidth: number;
}

const VIEWPORTS = [
  { name: "phone-320x568", width: 320, height: 568 },
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
];

async function readLayout(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const header = document.querySelector("[data-testid='knowledge-graph-header']");
    const canvas = document.querySelector("[data-testid='knowledge-graph-canvas']");
    if (!header || !canvas) throw new Error("harness did not render header/canvas");

    const toRect = (element: Element): Rect => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      header: toRect(header),
      canvas: toRect(canvas),
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

test.describe("knowledge graph workspace layout", () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} fits without overflow and keeps the canvas below the header`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(HARNESS);
      await page.waitForSelector("[data-testid='knowledge-graph-header']");
      await page.evaluate(() => document.fonts.ready);

      const metrics = await readLayout(page);
      expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(metrics.canvas.top).toBeGreaterThanOrEqual(metrics.header.bottom - 0.5);
      expect(metrics.canvas.height).toBeGreaterThan(100);
      expect(metrics.canvas.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(metrics.header.height).toBeGreaterThanOrEqual(64);

      // Evidence for the device/layout pass; the test itself is the gate.
      await page.screenshot({
        path: `${RESULTS_DIR}/knowledge-graph-${viewport.name}.png`,
        fullPage: false,
      });
    });
  }

  test("respects a simulated top safe-area inset", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${HARNESS}?safeTop=24`);
    await page.waitForSelector("[data-testid='knowledge-graph-header']");

    const metrics = await readLayout(page);
    expect(metrics.header.top).toBeGreaterThanOrEqual(23.5);
    expect(metrics.canvas.top).toBeGreaterThanOrEqual(metrics.header.bottom - 0.5);
    expect(metrics.canvas.bottom).toBeLessThanOrEqual(844 + 1);
    await page.screenshot({
      path: `${RESULTS_DIR}/knowledge-graph-safe-top-390x844.png`,
      fullPage: false,
    });
  });

  test("phone filter sheet is dismissible and stays inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(HARNESS);
    await page.waitForSelector("[data-testid='knowledge-graph-header']");

    await page.getByRole("button", { name: "Toggle filters" }).click();
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await expect(dialog).toBeVisible();

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector("[role='dialog']")!.getBoundingClientRect();
      return {
        panelTop: panel.top,
        panelBottom: panel.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(geometry.panelTop).toBeGreaterThanOrEqual(15.5);
    expect(geometry.panelBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);

    await page.getByRole("button", { name: /Show 18 nodes/ }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    await expect(page.locator("[data-testid='knowledge-graph-canvas']")).toBeVisible();
  });

  test("e-ink mode strips color, shadow, and motion from the filter surface", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(HARNESS);
    await page.waitForSelector("[data-testid='knowledge-graph-header']");
    await page.evaluate(() => {
      document.documentElement.dataset.displayMode = "eink";
    });

    await page.getByRole("button", { name: "Toggle filters" }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();

    const styles = await page.evaluate(() => {
      const panel = document.querySelector("[role='dialog']")!;
      const computed = getComputedStyle(panel);
      const reduced = document.createElement("div");
      reduced.style.transitionDuration = "var(--md-duration-medium)";
      document.body.appendChild(reduced);
      const tokenDuration = getComputedStyle(reduced).transitionDuration;
      reduced.remove();
      return {
        background: computed.backgroundColor,
        color: computed.color,
        boxShadow: computed.boxShadow,
        transitionDuration: computed.transitionDuration,
        tokenDuration,
      };
    });

    expect(styles.background).toBe("rgb(255, 255, 255)");
    expect(styles.color).toBe("rgb(0, 0, 0)");
    expect(styles.boxShadow).toBe("none");
    expect(parseFloat(styles.transitionDuration)).toBeLessThanOrEqual(0.001);
    expect(parseFloat(styles.tokenDuration)).toBeLessThanOrEqual(0.001);
  });

  test("reduced motion collapses the Material duration tokens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(HARNESS);
    await page.evaluate(() => {
      document.documentElement.dataset.reducedMotion = "true";
    });
    const duration = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--md-duration-medium").trim(),
    );
    expect(duration).toBe("0ms");
  });

  test("desktop filter sidebar can be collapsed from the page control", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(HARNESS);
    await page.waitForSelector("[data-testid='knowledge-graph-header']");

    const filters = page.getByRole("button", { name: "Toggle filters" });
    await filters.click();
    await expect(page.getByRole("complementary", { name: "Graph filters" })).toBeVisible();
    const expanded = await filters.getAttribute("aria-expanded");
    expect(expanded).toBe("true");

    await filters.click();
    await expect(page.getByRole("complementary", { name: "Graph filters" })).toHaveCount(0);
    expect(await filters.getAttribute("aria-expanded")).toBe("false");

    const metrics = await readLayout(page);
    expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  });
});
