import { expect, test } from "@playwright/test";
import { last } from "./fixtures/study-reading-sources";

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: { executablePath: process.env.PLETHORA_TEST_CHROMIUM },
});

const harness = "/src/visual/entries/study-reading-flow-harness.html";
const detailViews = ["View Learning Cards", "View Extracts"];
test.setTimeout(60_000);

test("PDF text opens the EPUB selection menu and its Copy action uses the selected passage", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${harness}?reader=pdf`);
  const text = page.locator(".textLayer").getByText("A quorum can intersect", { exact: true });
  await expect(text).toBeVisible({ timeout: 35_000 });

  const bounds = (await text.boundingBox())!;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 2, y, { steps: 12 });
  await page.mouse.up();
  const selectionPopup = page.getByRole("toolbar", { name: /text selection/i });
  await expect(selectionPopup).toBeVisible();
  // The floating selection popup attaches its outside-mousedown listener after 100 ms.
  await page.waitForTimeout(150);
  await page.mouse.click(bounds.x + bounds.width / 2, y, { button: "right" });

  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Create Extract", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Create Flashcard/ })).toBeVisible();
  await expect(selectionPopup).toBeHidden();
  await menu.getByRole("menuitem", { name: /^Copy\b/ }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("quorum");
});

test("the PDF keeps its exact scroll offset through both toolbar views", async ({ page }) => {
  await page.goto(`${harness}?reader=pdf`);
  const reader = page.getByRole("region", { name: "Document content" });
  const scroll = reader.locator("[data-document-scroll-container]");
  await expect(scroll.locator('[data-pdf-page][data-page-number="2"] canvas')).toBeVisible({ timeout: 35_000 });
  const offset = await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight - element.clientHeight - 137;
    return element.scrollTop;
  });
  expect(offset).toBeGreaterThan(500);

  for (const detail of detailViews) {
    await page.getByRole("button", { name: detail, exact: true }).first().click();
    await expect(reader).toBeHidden();
    await page.getByRole("button", { name: "View Document", exact: true }).click();
    await expect(reader).toBeVisible();
    await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(offset);
  }
});

test("the EPUB keeps its chapter and ignores reader shortcuts in both toolbar views", async ({ page }) => {
  await page.goto(`${harness}?reader=epub`);
  const reader = page.getByRole("region", { name: "Document content" });
  const passage = reader.frameLocator('iframe[srcdoc*="/two.xhtml"]').getByText(last, { exact: true });
  await expect(reader.frameLocator('iframe[srcdoc*="/one.xhtml"]').getByText("A quorum can intersect across two majorities."))
    .toBeVisible({ timeout: 35_000 });
  await page.keyboard.press("End");
  await expect(passage).toBeInViewport();
  const passageTop = (await passage.boundingBox())!.y;

  for (const detail of detailViews) {
    await page.getByRole("button", { name: detail, exact: true }).first().click();
    await expect(reader).toBeHidden();
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("button", { name: "View Document", exact: true }).click();
    await expect(passage).toBeInViewport();
    await expect.poll(async () => (await passage.boundingBox())?.y).toBe(passageTop);
  }
});
