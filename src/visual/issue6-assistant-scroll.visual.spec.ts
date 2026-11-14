import { expect, test } from "@playwright/test";

test("preserves reading position across streaming, resize, conversations, and reopening", async ({ page }) => {
  await page.goto("/src/visual/entries/issue6-assistant-scroll-harness.html");
  const scroll = page.locator("[data-scroll]");
  const distanceFromBottom = () => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await scroll.evaluate((el) => { el.scrollTop = 380; });
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  const anchor = page.locator('[data-assistant-message-id="a-5"]');
  const relativeTop = () => anchor.evaluate((el) => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top);
  const before = await relativeTop();
  await page.getByRole("button", { name: "Append" }).click();
  await expect.poll(relativeTop).toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "Grow first" }).click();
  await expect.poll(relativeTop).toBeCloseTo(before, 0);
  await page.locator('[data-assistant-message-id="a-0"]').evaluate(async (element) => {
    const img = document.createElement("img");
    img.style.display = "block";
    img.style.height = "240px";
    img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5WX2sAAAAASUVORK5CYII=";
    element.append(img);
    await img.decode();
  });
  await expect.poll(relativeTop).toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "Switch" }).click();
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Switch" }).click();
  await expect.poll(relativeTop).toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "Open or close" }).click();
  await page.getByRole("button", { name: "Open or close" }).click();
  await expect.poll(relativeTop).toBeCloseTo(before, 0);
  await page.getByRole("button", { name: "Latest message" }).click();
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Append" }).click();
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(1);
  await scroll.evaluate((el) => { el.scrollTop = 300; });
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: "Latest message" })).toHaveCount(0);
});

test("restores from session state and advances to a surviving anchor", async ({ page }) => {
  await page.goto("/src/visual/entries/issue6-assistant-scroll-harness.html");
  const scroll = page.locator("[data-scroll]");
  await scroll.evaluate((el) => { el.scrollTop = 380; });
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(380, 0);
  await page.getByRole("button", { name: "Remove anchor" }).click();
  const nextTop = () => page.locator('[data-assistant-message-id="a-5"]').evaluate((el) => el.getBoundingClientRect().top - el.parentElement!.getBoundingClientRect().top);
  await expect.poll(nextTop).toBeCloseTo(0, 0);
});

test("the real assistant preserves position through provider changes and hydration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/src/visual/entries/assistant-controls-harness.html?picker&scroll&width=420");
  const scroll = page.locator("[data-assistant-messages]");
  await expect(scroll.locator("[data-assistant-message-id]")).toHaveCount(24);
  await scroll.evaluate((el) => { el.scrollTop = 300; });
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  const before = await scroll.evaluate((el) => el.scrollTop);
  await page.getByTitle("Change Active AI Model").click();
  await page.locator('[data-assistant-provider-option]:not([aria-pressed="true"])').first().click();
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await page.reload();
  await expect(scroll.locator("[data-assistant-message-id]")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
});

test("the real assistant does not jump to top after temporary layout collapse or periodic updates", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/src/visual/entries/assistant-controls-harness.html?scroll&width=420");
  const scroll = page.locator("[data-assistant-messages]");
  await expect(scroll.locator("[data-assistant-message-id]")).toHaveCount(24);

  // Scroll manually away from the bottom (non-follow mode)
  await scroll.evaluate((el) => { el.scrollTop = 320; });
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  const targetTop = await scroll.evaluate((el) => el.scrollTop);
  expect(targetTop).toBeGreaterThan(250);

  // Allow any user-interaction grace window to expire cleanly
  await page.waitForTimeout(350);

  // Simulate repeated real browser layout collapses (display: none & height: 0 flex clamp)
  for (let cycle = 0; cycle < 3; cycle++) {
    await scroll.evaluate((el) => {
      const host = el.closest("[data-paper-surface='chrome']") as HTMLElement | null;
      if (!host) throw new Error("Missing assistant panel root");
      host.style.display = "none";
    });
    await page.waitForTimeout(50);
    await scroll.evaluate((el) => {
      const host = el.closest("[data-paper-surface='chrome']") as HTMLElement | null;
      if (!host) throw new Error("Missing assistant panel root");
      host.style.display = "";
    });
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 2000 }).toBeCloseTo(targetTop, 0);
  }

  // Test transient scrollHeight collapse (children temporarily collapse so scrollHeight <= clientHeight,
  // clamping scrollTop to 0 and queuing async scroll event before recovery)
  await scroll.evaluate((el) => {
    const children = Array.from(el.children) as HTMLElement[];
    for (const child of children) child.style.display = "none";
    void el.getBoundingClientRect();
    for (const child of children) child.style.display = "";
    void el.getBoundingClientRect();
  });
  await page.waitForTimeout(150);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 2000 }).toBeCloseTo(targetTop, 0);

  // Also test transient scrollHeight collapse across animation frames (ResizeObserver + delayed scroll)
  await scroll.evaluate((el) => {
    const children = Array.from(el.children) as HTMLElement[];
    for (const child of children) child.style.display = "none";
  });
  await page.waitForTimeout(50);
  await scroll.evaluate((el) => {
    const children = Array.from(el.children) as HTMLElement[];
    for (const child of children) child.style.display = "";
  });
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 2000 }).toBeCloseTo(targetTop, 0);
});

test("the real assistant preserves position during EPUB-like split resizes, new messages, top scroll, and Latest message", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/src/visual/entries/assistant-controls-harness.html?scroll&width=420");
  const scroll = page.locator("[data-assistant-messages]");
  await expect(scroll.locator("[data-assistant-message-id]")).toHaveCount(24);

  // Move mouse inside scrollable conversation and intentionally scroll up away from bottom via real wheel
  const box = await scroll.boundingBox();
  if (!box) throw new Error("Missing scroll container box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -1400);
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  const manualTop = await scroll.evaluate((el) => el.scrollTop);
  expect(manualTop).toBeGreaterThan(100);

  // Wait beyond interaction grace timer
  await page.waitForTimeout(350);

  // Simulate EPUB side-panel layout changes resizing the Assistant container via ResizeObserver
  const widths = ["340px", "480px", "390px", "420px"];
  for (const width of widths) {
    await scroll.evaluate((el, w) => {
      const aside = el.closest("aside") as HTMLElement | null;
      if (aside) aside.style.width = w;
    }, width);
    await page.waitForTimeout(80);
  }
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop), { timeout: 2000 }).toBeGreaterThan(100);

  const topBeforeNewMessage = await scroll.evaluate((el) => el.scrollTop);

  // Append a new Assistant message while user is reading older messages: must NOT steal scroll position
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("assistant-panel-conversations-v1") ?? "{}");
    const entry = raw["controls-fixture"];
    if (!entry) throw new Error("Missing controls-fixture conversation");
    entry.messages.push({
      id: "fixture-new-older",
      role: "assistant",
      content: "New incoming message while reading older messages. ".repeat(10),
      timestamp: Date.now(),
    });
    localStorage.setItem("assistant-panel-conversations-v1", JSON.stringify(raw));
    window.dispatchEvent(new CustomEvent("plethora:synced-conversation", { detail: { key: "controls-fixture" } }));
  });
  await expect(scroll.locator("[data-assistant-message-id]")).toHaveCount(25);
  await page.waitForTimeout(150);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeCloseTo(topBeforeNewMessage, 0);

  // Click "Latest message": must jump to bottom and resume follow mode for new messages
  await page.getByRole("button", { name: "Latest message" }).click();
  await expect(page.getByRole("button", { name: "Latest message" })).toBeHidden();
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(48);

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("assistant-panel-conversations-v1") ?? "{}");
    const entry = raw["controls-fixture"];
    entry.messages.push({
      id: "fixture-new-follow",
      role: "assistant",
      content: "Another message while following latest. ".repeat(10),
      timestamp: Date.now(),
    });
    localStorage.setItem("assistant-panel-conversations-v1", JSON.stringify(raw));
    window.dispatchEvent(new CustomEvent("plethora:synced-conversation", { detail: { key: "controls-fixture" } }));
  });
  await expect(scroll.locator("[data-assistant-message-id]")).toHaveCount(26);
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(48);

  // User intentionally scrolls to very top via real wheel events and waits through periodic ResizeObserver updates
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -1000);
    if ((await scroll.evaluate((el) => el.scrollTop)) === 0) break;
  }
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(page.getByRole("button", { name: "Latest message" })).toBeVisible();
  await page.waitForTimeout(400);
  await scroll.evaluate((el) => {
    const aside = el.closest("aside") as HTMLElement | null;
    if (aside) aside.style.width = "400px";
  });
  await page.waitForTimeout(150);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
});
