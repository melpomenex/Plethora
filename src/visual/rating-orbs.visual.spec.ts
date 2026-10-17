import { expect, test, type Page } from "@playwright/test";
import { contrastRatio, parseColor } from "../themes/color";

async function load(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rating-orbs-harness.html");
  await expect(page.locator("[data-rating-dock]")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.ratingHarness?.themes.length > 0);
}

async function gap(page: Page) {
  return page.evaluate(() => document.querySelector(".mobile-assistant-pill")!.getBoundingClientRect().top
    - document.querySelector("[data-rating-dock]")!.getBoundingClientRect().bottom);
}

async function assertActionsReachable(page: Page) {
  for (const name of ["Again", "Hard", "Good", "Easy", "Dismiss", "Drag to move panel", "Change panel edge"]) {
    const button = page.locator("[data-rating-dock]").getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    const result = await button.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
        hit: element.contains(hit), viewport: window.innerWidth, viewportHeight: window.innerHeight };
    });
    expect(result.width, name).toBeGreaterThanOrEqual(44);
    expect(result.height, name).toBeGreaterThanOrEqual(44);
    expect(result.x, name).toBeGreaterThanOrEqual(0);
    expect(result.right, name).toBeLessThanOrEqual(result.viewport);
    expect(result.top, name).toBeGreaterThanOrEqual(0);
    expect(result.bottom, name).toBeLessThanOrEqual(result.viewportHeight);
    expect(result.hit, name).toBe(true);
  }
}

for (const [name, width, height] of [["phone-320", 320, 740], ["phone-390", 390, 844], ["landscape", 844, 390]] as const) {
  test(`${name}: bottom dock clears Assistant, fits, and retains rating behavior`, async ({ page }) => {
    await load(page, width, height);
    await expect.poll(() => gap(page)).toBeGreaterThanOrEqual(7.9);
    await assertActionsReachable(page);
    await page.getByRole("button", { name: "Good", exact: true }).click();
    await expect(page.locator("#last-action")).toHaveText("grade:3");
    await page.screenshot({ path: `.playwright/rating-${name}.png` });
  });
}

test("safe areas, enlarged bubble, hidden controls, restoration and menu docking", async ({ page }) => {
  await load(page);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".adaptive-shell-root")!.style.setProperty("--shell-safe-bottom", "34px");
    document.querySelector<HTMLElement>(".mobile-assistant-pill")!.style.minHeight = "76px";
    document.querySelector<HTMLElement>(".mobile-bottom-nav")!.style.minHeight = "90px";
  });
  await expect.poll(() => gap(page)).toBeGreaterThanOrEqual(7.9);
  await page.screenshot({ path: ".playwright/rating-safe-area.png" });
  const raised = await page.locator("[data-rating-dock]").boundingBox();
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>(".mobile-assistant-pill")!.hidden = true; });
  await expect.poll(async () => (await page.locator("[data-rating-dock]").boundingBox())!.y).toBeGreaterThan(raised!.y);
  await page.evaluate(() => { document.querySelector<HTMLButtonElement>(".mobile-assistant-pill")!.hidden = false; });
  await expect.poll(() => gap(page)).toBeGreaterThanOrEqual(7.9);
  await page.evaluate(() => window.ratingHarness.setFullscreen(true));
  await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeHidden();
  await expect.poll(async () => (await page.locator("[data-rating-dock]").boundingBox())!.y).toBeGreaterThan(raised!.y);
  await page.evaluate(() => window.ratingHarness.setFullscreen(false));
  await expect.poll(() => gap(page)).toBeGreaterThanOrEqual(7.9);
  await page.getByRole("button", { name: "Change panel edge" }).click();
  await page.getByRole("button", { name: "Move Top", exact: true }).click();
  await expect(page.locator("[data-rating-dock]")).toHaveAttribute("data-edge", "top");
  await page.getByRole("button", { name: "Change panel edge" }).click();
  await page.getByRole("button", { name: "Move Bottom", exact: true }).click();
  await expect.poll(() => gap(page)).toBeGreaterThanOrEqual(7.9);
  await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
  await assertActionsReachable(page);
  await page.screenshot({ path: ".playwright/rating-enlarged-text.png" });
});

test("Assistant sheet owns pointer and keyboard interaction, then restores dock", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-rating-dock]").locator("..")).toHaveAttribute("inert", "");
  await page.locator('[data-rating-action="again"]').evaluate(element => (element as HTMLButtonElement).focus());
  expect(await page.locator('[data-rating-action="again"]').evaluate(element => element === document.activeElement)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(() => gap(page)).toBeGreaterThanOrEqual(7.9);
  await page.getByRole("button", { name: "Good", exact: true }).click();
  await expect(page.locator("#last-action")).toHaveText("grade:3");
});

test("desktop four-edge docking and a short viewport keep actions and menus reachable", async ({ page }) => {
  await load(page, 1440, 1000);
  await page.evaluate(() => window.ratingHarness.setMobile(false));
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    await page.evaluate(edge => window.ratingHarness.setEdge(edge), edge);
    await assertActionsReachable(page);
    await page.screenshot({ path: `.playwright/rating-desktop-${edge}.png` });
  }
  await page.setViewportSize({ width: 640, height: 280 });
  await page.evaluate(() => window.ratingHarness.setEdge("left"));
  await assertActionsReachable(page);
  await page.getByRole("button", { name: "Change panel edge" }).click();
  await page.getByRole("button", { name: "Move Bottom", exact: true }).click();
  await expect(page.locator("[data-rating-dock]")).toHaveAttribute("data-edge", "bottom");
});

test("themes update orbs, utilities, tooltips and states with readable contrast", async ({ page }) => {
  await load(page);
  let previous = "";
  for (const theme of ["milky-matcha", "obsidian-noir", "biolume-abyss"]) {
    await page.evaluate(theme => window.ratingHarness.setTheme(theme), theme);
    await expect(page.locator("#active-theme")).toHaveText(theme);
    const colors = await page.locator(".rating-orb").evaluateAll(elements => elements.map(element => {
      const css = getComputedStyle(element);
      return { action: element.getAttribute("data-rating-action"), background: css.backgroundColor, foreground: css.color };
    }));
    expect(colors.find(c => c.action === "good")!.background).not.toBe(previous);
    previous = colors.find(c => c.action === "good")!.background;
    for (const color of colors) expect(contrastRatio(parseColor(color.background)!, parseColor(color.foreground)!)).toBeGreaterThanOrEqual(4.5);
    expect(colors.filter(c => c.action === "good").map(c => c.background)).toEqual([previous, previous]);
    const good = page.getByRole("button", { name: "Good", exact: true });
    await good.focus();
    await expect(page.getByRole("tooltip", { name: "Good", exact: true })).toBeVisible();
    const focus = await good.evaluate(element => { const css = getComputedStyle(element); return { outline: css.outlineColor, background: css.backgroundColor }; });
    expect(contrastRatio(parseColor(focus.outline)!, parseColor(focus.background)!)).toBeGreaterThanOrEqual(3);
    await page.getByRole("button", { name: "Change panel edge" }).click();
    await page.screenshot({ path: `.playwright/rating-theme-${theme}.png` });
    await page.getByRole("button", { name: "Change panel edge" }).click();
  }
  await page.evaluate(() => { document.documentElement.dataset.displayMode = "eink"; });
  const monochrome = await page.getByRole("button", { name: "Good", exact: true }).evaluate(element => { const css = getComputedStyle(element); return [css.color, css.backgroundColor]; });
  expect(monochrome).toEqual(["rgb(0, 0, 0)", "rgb(255, 255, 255)"]);
  await page.screenshot({ path: ".playwright/rating-theme-eink.png" });
  await page.evaluate(() => window.ratingHarness.setRating(true));
  await expect(page.getByRole("button", { name: "Good", exact: true })).toBeDisabled();
  await expect(page.locator("#last-action")).toHaveText("none");
});
