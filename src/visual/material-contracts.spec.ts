import { expect, test } from "@playwright/test";

test("checked indicators are visible and snackbar stacks above both dialogs", async ({ page }) => {
  await page.goto("/src/visual/fixtures/material.html");
  for (const role of ["checkbox", "radio"] as const) {
    const input = page.getByRole(role);
    await expect(input).toBeChecked();
    const indicator = input.locator("xpath=following-sibling::span/*");
    await expect(indicator).toHaveCSS("opacity", "1");
    await input.evaluate((element: HTMLInputElement) => { element.checked = false; });
    await expect(indicator).toHaveCSS("opacity", "0");
  }
  const stacking = await page.evaluate(() => {
    const adaptive = document.querySelector(".adaptive-dialog-layer")!;
    const dialog = document.querySelector(".md-dialog-scrim")!.parentElement!;
    const toast = document.querySelector(".toast-container")!;
    return [adaptive, dialog, toast].map((element) => Number(getComputedStyle(element).zIndex));
  });
  expect(stacking[1]).toBeGreaterThan(stacking[0]);
  expect(stacking[2]).toBeGreaterThan(stacking[1]);
  expect(stacking[2]).toBeLessThan(9998);
});
