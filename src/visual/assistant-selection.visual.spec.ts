import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("right-clicking selected Assistant text leaves its menu open beside the reader", async ({ page }) => {
  await page.goto("/src/visual/entries/assistant-controls-harness.html?scroll&reader-selection");
  const reader = page.getByRole("region", { name: "Document content" });
  await expect(reader).toBeVisible();
  const conversation = page.locator("[data-assistant-messages]");
  const message = page.getByText(/^Message 22\./);
  await expect(message).toBeVisible();
  const points = await message.evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEnd(element.firstChild!, 11);
    const { left, right, top, height } = range.getBoundingClientRect();
    return { left, right, y: top + height / 2 };
  });
  await page.mouse.move(points.left, points.y);
  await page.mouse.down();
  await page.mouse.move(points.right, points.y, { steps: 8 });
  await page.mouse.up();
  const selectedText = await page.evaluate(() => window.getSelection()?.toString().trim());
  expect(selectedText).toBe("Message 22.");
  const scrollTop = await conversation.evaluate((element) => element.scrollTop);

  await page.mouse.click((points.left + points.right) / 2, points.y, { button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Copy Selection" })).toBeVisible();

  // Another response can grow while the user is deciding which action to take.
  await conversation.locator('[data-assistant-message-id="fixture-23"]').evaluate(async (element) => {
    element.style.minHeight = `${element.getBoundingClientRect().height + 120}px`;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

  expect(await conversation.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(selectedText);
  await expect(page.getByTestId("selection-context-chip")).toHaveCount(0);
  await expect(reader.locator("[data-extract-button]")).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Ask about Selection" }).click();
  await expect(page.getByRole("textbox")).toHaveValue(`> ${selectedText}\n`);
  await expect(menu).toHaveCount(0);
});
