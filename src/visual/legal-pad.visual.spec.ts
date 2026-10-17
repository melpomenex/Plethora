import { test, expect } from "@playwright/test";

test("paper is decoded, interactive, previewable and reversible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/legal-pad-harness.html");
  await expect(page.locator('main[data-ready="true"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme-material", "paper");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#selection-target")).toBeVisible();
  const state = await page.evaluate(async () => {
    const doc = document.querySelector("iframe")!.contentDocument!;
    const background = getComputedStyle(doc.documentElement).backgroundImage;
    const url = background.match(/url\("?([^")]+)"?\)/)?.[1];
    const image = new Image();
    image.src = url!;
    await image.decode();
    const p = doc.querySelector("#selection-target")!;
    const range = doc.createRange();
    range.selectNodeContents(p);
    doc.getSelection()!.addRange(range);
    (window as any).__paperNode = p.firstChild;
    return { background, width: image.naturalWidth, text: doc.getSelection()!.toString() };
  });
  expect(state.background).toContain("grain-authentic");
  expect(state.width).toBeGreaterThanOrEqual(512);
  expect(state.text).toContain("well-read page");
  await page.evaluate(() => window.legalPadHarness.preview("obsidian-noir"));
  await expect(page.locator("html")).not.toHaveAttribute("data-theme-material", "paper");
  await page.evaluate(() => window.legalPadHarness.preview(null));
  await expect(page.locator("html")).toHaveAttribute("data-theme-material", "paper");
  expect(
    await page.evaluate(
      () =>
        document.querySelector("iframe")!.contentDocument!.querySelector("#selection-target")!
          .firstChild === (window as any).__paperNode
    )
  ).toBe(true);
  await page.screenshot({ path: ".playwright/legal-pad-desktop.png", animations: "disabled", timeout: 10000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".playwright/legal-pad-phone.png", animations: "disabled", timeout: 10000 });
});


test.describe('high density phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  test('selects and decodes a bounded high-density texture', async ({ page }) => {
    await page.goto('/legal-pad-harness.html');
    await expect(page.locator('html')).toHaveAttribute('data-theme-material','paper');
    const sample=await page.evaluate(async()=>{
      const css=getComputedStyle(document.documentElement).getPropertyValue('--paper-grain');
      const url=css.match(/url\("?([^")]+)"?\)/)?.[1];
      const image=new Image();image.src=url!;await image.decode();
      return {dpr:window.devicePixelRatio,width:image.naturalWidth};
    });
    expect(sample.dpr).toBe(3);expect(sample.width).toBeGreaterThanOrEqual(1024);expect(sample.width).toBeLessThanOrEqual(1536);
  });
});
