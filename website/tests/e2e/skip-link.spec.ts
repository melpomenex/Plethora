import { test, expect } from '@playwright/test';

test('skip link moves focus to main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByTestId('skip-link');
  await expect(skip).toBeFocused();
  await skip.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#main');
  await expect(page.locator('#main')).toBeInViewport();
});
