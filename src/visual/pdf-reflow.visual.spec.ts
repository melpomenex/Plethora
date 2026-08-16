import { expect, test } from "@playwright/test";

/**
 * PDF reflow visual regression (task 10.2). These run against the dev server
 * with the canonical reflow flags forced on via localStorage init script.
 * Baselines live in src/visual/__snapshots__; a first run creates them,
 * subsequent runs gate at 2% pixel diff.
 *
 * Environment note: the app needs its Rust backend for documents; until a
 * seeded demo document ships, these tests load the fixture PDFs directly
 * through the browser (pdf.js path) and assert layout invariants — clipping,
 * overlap-free reflow columns, figure sizing — via geometry snapshots that
 * don't require the native backend. Backend-dependent journeys stay on the
 * manual smoke checklist (task 10.6).
 *
 * The harness (public/visual-harness.html) mounts the real renderer with
 * deterministic SVG data-URL figures — wide/tall/square/tiny crops plus one
 * whose URL is aborted — covering every intrinsic-dims source (measured
 * crop, model sourceWidth/sourceHeight, bbox fallback) and the pre-load
 * aspect-box reservation.
 */

const VIEWPORTS = [
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-412", width: 412, height: 915 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
];

interface FigureGeometry {
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  displayedWidth: number;
  displayedHeight: number;
}

async function figureGeometries(page: import("@playwright/test").Page): Promise<FigureGeometry[]> {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-pdf-reflow-block] img")).map((element) => {
      const img = element as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      return {
        alt: img.alt,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        displayedWidth: rect.width,
        displayedHeight: rect.height,
      };
    }),
  );
}

test.describe("reflow renderer layout", () => {
  for (const viewport of VIEWPORTS) {
    test(`text and figure layout at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // The renderer is exercised through a minimal harness page served by
      // the dev server (public/visual-harness.html) that mounts the
      // canonical reflow renderer on a deterministic fixture model. The
      // blocked route keeps one figure permanently unloaded so the pre-load
      // reservation can be measured.
      await page.route("**/blocked-figure.png", (route) => route.abort());
      await page.goto("/visual-harness.html");
      await page.waitForSelector("[data-pdf-reflow-page] img");
      await page.waitForFunction(() => {
        const imgs = Array.from(document.querySelectorAll("[data-pdf-reflow-block] img"));
        return imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0 || img.getAttribute("src")?.includes("blocked"));
      });

      // (a) No horizontal clipping at any viewport: reflow fits the width.
      const overflow = await page.evaluate(() => {
        const article = document.querySelector(".pdf-reflow-content");
        return article ? article.scrollWidth - article.clientWidth : 0;
      });
      expect(overflow).toBeLessThanOrEqual(1);

      // (b) Every loaded figure: decoded (naturalWidth > 0) and displayed
      // aspect within ±2% of the natural aspect — never stretched.
      const figures = await figureGeometries(page);
      expect(figures.length).toBeGreaterThanOrEqual(4);
      for (const figure of figures) {
        if (figure.alt.startsWith("Blocked")) continue;
        expect(figure.naturalWidth, `${figure.alt} naturalWidth`).toBeGreaterThan(0);
        expect(figure.displayedWidth, `${figure.alt} displayedWidth`).toBeGreaterThan(0);
        const naturalRatio = figure.naturalWidth / figure.naturalHeight;
        const displayedRatio = figure.displayedWidth / figure.displayedHeight;
        expect(
          Math.abs(displayedRatio - naturalRatio) / naturalRatio,
          `${figure.alt} aspect drift (displayed ${displayedRatio}, natural ${naturalRatio})`,
        ).toBeLessThan(0.02);
      }

      // (c) Reserved space before the asset loads: the blocked figure never
      // decodes, but its aspect box still holds a non-zero height, and the
      // reserved box's width/height ratio must match the expected aspect ±2%
      // (a fixed-height placeholder — e.g. an 8px strip — would hold height
      // but the wrong shape and scroll-jump on load). The harness pins the
      // blocked figure's aspect at 1000×500 via assetDims (public/
      // visual-harness.html), and its bbox fallback (400×200) agrees: 2.0.
      const reserved = await page.evaluate(() => {
        const box = document.querySelector('[data-pdf-reflow-block="p1:figblocked"] .pdf-reflow-visual-box');
        if (!box) return null;
        const rect = box.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
      expect(reserved, "blocked figure aspect box exists").not.toBeNull();
      expect(reserved!.height).toBeGreaterThan(0);
      expect(reserved!.width).toBeGreaterThan(0);
      const expectedAspect = 1000 / 500;
      const reservedRatio = reserved!.width / reserved!.height;
      expect(
        Math.abs(reservedRatio - expectedAspect) / expectedAspect,
        `reserved aspect box ratio (displayed ${reservedRatio}, expected ${expectedAspect})`,
      ).toBeLessThan(0.02);
      const blockedDecoded = await page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('[data-pdf-reflow-block="p1:figblocked"] img');
        return img ? img.naturalWidth : -1;
      });
      expect(blockedDecoded).toBe(0);

      // No ancestor clipping in fit mode: any ancestor that clips on the x
      // axis must still fully contain every rendered figure (computed-style
      // audit up to <body>).
      const clipping = await page.evaluate(() => {
        const offenders: string[] = [];
        for (const element of document.querySelectorAll("[data-pdf-reflow-block] img")) {
          const img = element as HTMLImageElement;
          if (img.alt.startsWith("Blocked")) continue;
          const rect = img.getBoundingClientRect();
          let node = img.parentElement;
          while (node && node !== document.body) {
            const style = getComputedStyle(node);
            const axis = [style.overflowX, style.overflowY];
            const clips = axis.some((value) => value === "hidden" || value === "clip");
            if (clips) {
              const box = node.getBoundingClientRect();
              const outside = rect.left < box.left - 0.5 || rect.right > box.right + 0.5
                || rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5;
              if (outside) offenders.push(`${node.tagName}.${node.className} clips ${img.alt}`);
            }
            node = node.parentElement;
          }
        }
        return offenders;
      });
      expect(clipping).toEqual([]);

      await expect(page.locator(".pdf-reflow-content")).toHaveScreenshot();
    });
  }

  test("image scaling modes: fit shows the full image, original scrolls, hide removes figures", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/blocked-figure.png", (route) => route.abort());
    await page.goto("/visual-harness.html");
    await page.waitForSelector("[data-pdf-reflow-page] img");
    const setMode = (mode: string) =>
      page.evaluate((value) => {
        (document.querySelector(".pdf-mobile-reflow") as HTMLElement).dataset.imageScaling = value;
      }, mode);

    // fit (default): the wide chart scales into the content width with its
    // full height visible.
    await setMode("fit");
    let figures = await figureGeometries(page);
    const wideFit = figures.find((figure) => figure.alt.startsWith("Wide"))!;
    const contentWidth = await page.evaluate(
      () => (document.querySelector(".pdf-reflow-content") as HTMLElement).clientWidth,
    );
    expect(wideFit.displayedWidth).toBeLessThanOrEqual(contentWidth + 1);
    expect(Math.round(wideFit.displayedHeight)).toBeGreaterThan(0);

    // original: natural pixel size, and the document grows horizontally
    // scrollable (overflow is reachable, not clipped).
    await setMode("original");
    figures = await figureGeometries(page);
    const wideOriginal = figures.find((figure) => figure.alt.startsWith("Wide"))!;
    expect(Math.round(wideOriginal.displayedWidth)).toBe(1200);
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(scrollable).toBeGreaterThan(0);

    // hide: no figure image is rendered in the layout.
    await setMode("hide");
    const visible = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-pdf-reflow-block] img")).filter(
        (img) => img.getClientRects().length > 0,
      ).length,
    );
    expect(visible).toBe(0);
  });
});
