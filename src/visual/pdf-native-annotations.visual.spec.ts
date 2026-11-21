import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1100, height: 620 } });

test("displays embedded PDF links and notes, and follows an internal destination", async ({ page }) => {
  await page.goto("/src/visual/entries/pdf-native-annotations-harness.html");

  const pageIndicator = page.getByRole("group", { name: "Page indicator" }).getByRole("spinbutton");
  await expect(pageIndicator).toHaveValue("1");

  const firstPage = page.locator(".page[data-page-number='1']");
  const externalLink = firstPage.locator(".linkAnnotation a[href='https://example.com/']");
  await expect(externalLink).toBeVisible();
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", /\bnoopener\b/);
  await expect(externalLink).toHaveAttribute("rel", /\bnoreferrer\b/);

  await firstPage.locator(".textAnnotation img").hover();
  await expect(firstPage.getByText("Fixture author", { exact: true })).toBeVisible();
  await expect(firstPage.getByText("This note is embedded in the PDF.", { exact: true })).toBeVisible();

  await firstPage.locator(".linkAnnotation[data-internal-link] > a").click();
  await expect(pageIndicator).toHaveValue("3");
  await expect(page.locator(".page[data-page-number='3']")).toBeInViewport();
});

test("activates an embedded PDF destination with the keyboard", async ({ page }) => {
  await page.goto("/src/visual/entries/pdf-native-annotations-harness.html");

  const pageIndicator = page.getByRole("group", { name: "Page indicator" }).getByRole("spinbutton");
  await expect(pageIndicator).toHaveValue("1");

  const link = page.locator(".page[data-page-number='1'] .linkAnnotation[data-internal-link] > a");
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(pageIndicator).toHaveValue("3");
  await expect(page.locator(".page[data-page-number='3']")).toBeInViewport();
});

test("retains PDF form edits when the page view is remounted", async ({ page }) => {
  await page.goto("/src/visual/entries/pdf-native-annotations-harness.html?form");

  const firstPage = page.locator(".page[data-page-number='1']");
  const name = firstPage.locator(".textWidgetAnnotation input[name='Name']");
  const reviewComplete = firstPage.locator(".buttonWidgetAnnotation input[name='Review complete']");
  await expect(name).toHaveValue("Initial name");
  await expect(reviewComplete).not.toBeChecked();

  await name.fill("Edited name");
  await reviewComplete.check();

  const pageIndicator = page.getByRole("group", { name: "Page indicator" }).getByRole("spinbutton");
  await expect(pageIndicator).toHaveAttribute("max", "13");
  await pageIndicator.fill("8");
  await pageIndicator.press("Enter");
  await expect(firstPage).toHaveCount(0);

  await pageIndicator.fill("1");
  await pageIndicator.press("Enter");
  await expect(name).toHaveValue("Edited name");
  await expect(reviewComplete).toBeChecked();
});
