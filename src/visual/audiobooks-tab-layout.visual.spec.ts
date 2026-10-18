/**
 * Regression contract for the Audio Editions shelf on the Audiobooks tab.
 *
 * The edition card row (icon + title + five action buttons) used to size the
 * mobile grid track from its max-content width: on a phone the single implicit
 * grid column measured ~654px against a 360px viewport, so the card (and the
 * controls) ran off the right edge. At `sm` widths the explicit two-column
 * template contained the card, but the title was squeezed to 0px.
 *
 * Run: npm run test:visual -- audiobooks-tab-layout
 */
import { expect, test, type Page } from "@playwright/test";

const CARD = '[data-testid="edition-card-edition-1"]';

async function openShelf(page: Page) {
  await page.goto("/audiobooks-tab-harness.html");
  await page.locator(CARD).waitFor({ state: "visible" });
}

async function cardGeometry(page: Page) {
  return page.evaluate((selector) => {
    const card = document.querySelector(selector)!;
    const rect = card.getBoundingClientRect();
    const title = card.querySelector("span.truncate")!;
    const titleRect = title.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      cardLeft: rect.left,
      cardRight: rect.right,
      cardWidth: rect.width,
      titleWidth: titleRect.width,
      titleClientWidth: title.clientWidth,
      titleScrollWidth: title.scrollWidth,
    };
  }, CARD);
}

for (const width of [320, 360, 390, 412]) {
  test(`phone ${width}px: edition card stays inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openShelf(page);

    const geometry = await cardGeometry(page);
    expect(geometry.cardLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.cardWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    // The title must keep usable space next to the action buttons.
    expect(geometry.titleClientWidth).toBeGreaterThan(0);
    expect(geometry.titleWidth).toBeGreaterThan(0);
  });
}

for (const width of [700, 1024, 1440]) {
  test(`${width}px: edition card keeps a readable title`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openShelf(page);

    const geometry = await cardGeometry(page);
    expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.titleWidth).toBeGreaterThan(80);
    expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  });
}
