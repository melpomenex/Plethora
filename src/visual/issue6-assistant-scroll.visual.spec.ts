import { expect, test } from "@playwright/test";

test("preserves reading position across streaming, resize, conversations, and reopening", async ({ page }) => {
  await page.goto("/issue6-assistant-scroll-harness.html");
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
  await page.goto("/issue6-assistant-scroll-harness.html");
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
  await page.goto("/assistant-controls-harness.html?picker&scroll&width=420");
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
