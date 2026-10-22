import { expect, test, type Page } from "@playwright/test";

async function load(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/rating-orbs-harness.html?priority");
  await page.waitForFunction(() => window.ratingHarness?.themes.length > 0);
  await expect(page.getByRole("button", { name: "Reading Priority: Normal" })).toBeVisible();
}

async function upperControls(page: Page, minimum = 44) {
  const boxes = await page.locator("[data-queue-header] button").evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect();
    return { name: button.getAttribute("aria-label") ?? button.getAttribute("title"), x: box.x, y: box.y,
      right: box.right, bottom: box.bottom, width: box.width, height: box.height,
      hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
  }));
  const viewport = page.viewportSize()!;
  for (const box of boxes) {
    expect(box.width, box.name!).toBeGreaterThanOrEqual(minimum);
    expect(box.height, box.name!).toBeGreaterThanOrEqual(minimum);
    expect(box.x, box.name!).toBeGreaterThanOrEqual(16);
    expect(box.right, box.name!).toBeLessThanOrEqual(viewport.width - 16);
    expect(box.y, box.name!).toBeGreaterThanOrEqual(16);
    expect(box.bottom, box.name!).toBeLessThan(viewport.height);
    expect(box.hit, box.name!).toBe(true);
  }
  for (let i = 0; i < boxes.length; i++) for (const other of boxes.slice(i + 1)) {
    const box = boxes[i];
    expect(box.right <= other.x || other.right <= box.x || box.bottom <= other.y || other.bottom <= box.y,
      `${box.name} overlaps ${other.name}`).toBe(true);
  }
}

async function dockClearsHeader(page: Page) {
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    await page.evaluate(edge => window.ratingHarness.setEdge(edge), edge);
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector("[data-queue-header]")!.getBoundingClientRect();
      const dock = document.querySelector("[data-rating-dock]")!.getBoundingClientRect();
      return dock.top - header.bottom;
    })).toBeGreaterThanOrEqual(7.9);
  }
}

for (const [width, height] of [[320, 740], [360, 780], [390, 844], [430, 932], [844, 390]]) {
  test(`${width}x${height}: upper controls, all dock edges and priority are reachable`, async ({ page }) => {
    await load(page, width, height);
    await upperControls(page);
    await dockClearsHeader(page);
    await page.getByRole("button", { name: "Item details" }).click();
    await expect(page.locator("#last-action")).toHaveText("details");
    await page.getByRole("button", { name: "View extracts", exact: true }).click();
    await expect(page.locator("#last-action")).toHaveText("mode:extracts");
    await page.getByRole("button", { name: "Reading Priority: Normal" }).click();
    const sheet = page.getByRole("dialog", { name: "Reading Priority" });
    await expect(sheet).toHaveClass(/adaptive-dialog-sheet/);
    await expect(page.locator("#last-action")).toHaveText("mode:extracts");
    const normal = sheet.getByRole("button", { name: "Normal", exact: true });
    await expect(normal).toHaveAttribute("aria-pressed", "true");
    await sheet.getByRole("button", { name: "Highest", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: "Reading Priority: Highest" })).toBeVisible();
    await expect(page.locator("#last-action")).toHaveText("priority:90");
    await page.screenshot({ path: `.playwright/priority-${width}x${height}.png` });
  });
}

test("safe areas and enlarged translated neural controls wrap inside the measured header", async ({ page }) => {
  await load(page, 320, 900);
  await page.evaluate(() => {
    window.ratingHarness.setLong(true); window.ratingHarness.setNeural(true);
    const shell = document.querySelector<HTMLElement>(".adaptive-shell-root")!;
    shell.style.setProperty("--shell-safe-top", "28px");
    shell.style.setProperty("--shell-safe-left", "12px");
    shell.style.setProperty("--shell-safe-right", "12px");
    document.documentElement.style.fontSize = "24px";
  });
  await upperControls(page);
  const safe = await page.locator("[data-queue-header] button").evaluateAll(buttons => buttons.map(button => {
    const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right };
  }));
  for (const box of safe) { expect(box.x).toBeGreaterThanOrEqual(28); expect(box.right).toBeLessThanOrEqual(292); expect(box.y).toBeGreaterThanOrEqual(44); }
  await dockClearsHeader(page);
  await page.getByRole("button", { name: /Reading Priority:/ }).click();
  const sheet = page.getByRole("dialog");
  for (const button of await sheet.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await sheet.getByRole("slider").scrollIntoViewIfNeeded();
  await expect(sheet.getByRole("slider")).toBeInViewport();
  await page.screenshot({ path: ".playwright/priority-translated-large.png" });
});

test("short landscape sheet scrolls, traps focus, blocks shell and restores position on dismissal", async ({ page }) => {
  await load(page, 740, 320);
  const reader = page.locator(".mobile-main-content");
  await reader.evaluate(element => { element.scrollTop = 220; });
  const top = await reader.evaluate(element => element.scrollTop);
  const trigger = page.getByRole("button", { name: "Reading Priority: Normal" });
  for (const dismissal of ["close", "Escape", "backdrop"]) {
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(page.locator(".adaptive-shell-root")).toHaveAttribute("inert", "");
    await sheet.getByRole("slider").scrollIntoViewIfNeeded();
    await expect(sheet.getByRole("slider")).toBeInViewport();
    const bounds = (await sheet.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(16);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(304);
    await sheet.getByRole("slider").focus();
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate(element => element.contains(document.activeElement))).toBe(true);
    if (dismissal === "close") await sheet.getByRole("button", { name: "Close", exact: true }).click();
    else if (dismissal === "Escape") await page.keyboard.press("Escape");
    else await page.mouse.click(4, 4);
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await reader.evaluate(element => element.scrollTop)).toBe(top);
    await expect(page.locator("#last-action")).toHaveText("none");
    await expect(page.locator(".adaptive-shell-root")).not.toHaveAttribute("inert");
  }
});

test("pointer and keyboard slider completion save without duplicate blur commits", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: /Reading Priority:/ }).click();
  const slider = page.getByRole("slider");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(page.locator("#last-action")).toHaveText(/priority:7\d/);
  await slider.focus(); await page.keyboard.press("Home");
  await expect(page.locator("#last-action")).toHaveText("priority:0");
  await page.keyboard.press("End");
  await expect(page.locator("#last-action")).toHaveText("priority:100");
});

test("touch slider drag completes and vertical scrolling leaves the sheet open", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 600 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await load(page, 390, 600);
  await page.getByRole("button", { name: /Reading Priority:/ }).tap();
  const slider = page.getByRole("slider");
  const box = (await slider.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  const y = box.y + box.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y }] });
  for (const fraction of [0.55, 0.65, 0.75, 0.85]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width * fraction, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator("#last-action")).toHaveText(/priority:8\d/);
  const saved = await page.locator("#last-action").textContent();
  await page.setViewportSize({ width: 390, height: 320 });
  await page.evaluate(() => { window.ratingHarness.setLong(true); document.documentElement.style.fontSize = "24px"; });
  await slider.scrollIntoViewIfNeeded();
  const body = page.locator(".adaptive-dialog-body");
  const beforeScroll = await body.evaluate(element => element.scrollTop);
  expect(beforeScroll).toBeGreaterThan(0);
  const scrollBox = (await slider.boundingBox())!;
  const x = scrollBox.x + scrollBox.width / 2, startY = scrollBox.y + scrollBox.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
  for (const delta of [8, 16, 24, 32]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + delta }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeLessThan(beforeScroll - 5);
  await expect(page.locator("#last-action")).toHaveText(saved!);
  await expect(page.getByRole("dialog")).toBeVisible();
  await context.close();
});

test("light, dark and e-ink preserve semantic surfaces and check selection", async ({ page }) => {
  await load(page);
  for (const theme of ["milky-matcha", "obsidian-noir"]) {
    await page.evaluate(theme => window.ratingHarness.setTheme(theme), theme);
    await page.getByRole("button", { name: /Reading Priority:/ }).click();
    const selected = page.getByRole("button", { name: "Normal", exact: true });
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(selected.locator("svg").last()).toBeVisible();
    await page.screenshot({ path: `.playwright/priority-${theme}.png` });
    await page.keyboard.press("Escape");
  }
  await page.evaluate(() => { document.documentElement.dataset.displayMode = "eink"; });
  await page.getByRole("button", { name: /Reading Priority:/ }).click();
  await expect(page.getByRole("button", { name: "Normal", exact: true }).locator("svg").last()).toBeVisible();
  await page.screenshot({ path: ".playwright/priority-eink.png" });
});

test("queue identities, eligibility and overlay lifetime control editor visibility", async ({ page }) => {
  await load(page);
  for (const item of ["document:2", "extract:1", "extract:2"]) {
    await page.getByRole("button", { name: /Reading Priority:/ }).click();
    await page.evaluate(item => window.ratingHarness.setItem(item), item);
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.getByRole("button", { name: /Reading Priority:/ }).click();
  await page.evaluate(() => window.ratingHarness.setVisible(false));
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.evaluate(() => window.ratingHarness.setVisible(true));
  for (const item of ["rss:1", "podcast:1", "flashcard:1"]) {
    await page.evaluate(item => window.ratingHarness.setItem(item), item);
    await expect(page.getByRole("button", { name: /Reading Priority:/ })).toBeHidden();
  }
});

test("desktop preserves anchored editing and action routing", async ({ page }) => {
  await load(page, 1440, 1000);
  await page.evaluate(() => window.ratingHarness.setMobile(false));
  await dockClearsHeader(page);
  await page.getByRole("button", { name: "View learning cards" }).click();
  await expect(page.locator("#last-action")).toHaveText("mode:cards");
  const trigger = page.getByRole("button", { name: /Reading Priority:/ });
  await trigger.click();
  await expect(page.getByRole("dialog")).not.toHaveClass(/adaptive-dialog-sheet/);
  const box = (await trigger.boundingBox())!, editor = (await page.getByRole("dialog").boundingBox())!;
  expect(editor.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(Math.abs(editor.x + editor.width - box.x - box.width)).toBeLessThan(2);
  await page.screenshot({ path: ".playwright/priority-desktop.png" });
});
