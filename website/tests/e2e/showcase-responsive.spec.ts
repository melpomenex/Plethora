import { test, expect, type Page } from '@playwright/test';

const VIEWPORTS = [
  { name: 'wide-desktop', width: 1440, height: 900 },
  { name: 'short-laptop', width: 1280, height: 720 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
] as const;

async function waitForScene(page: Page) {
  await expect(page.locator('[data-demo-island]')).toBeVisible();
  await expect(page.locator('[data-image-state="ready"]:visible').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const viewport of VIEWPORTS) {
  test(`Reading Desk narrative at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/#demo');
    await page.locator('#demo').scrollIntoViewIfNeeded();
    await waitForScene(page);

    await expect(page).toHaveScreenshot(`reading-desk-${viewport.name}.png`, {
      animations: 'disabled',
      caret: 'hide',
    });
  });
}

test('lazy homepage scenes wait for the viewport before starting their failure timer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#demo');
  await page.locator('#demo').scrollIntoViewIfNeeded();
  await waitForScene(page);

  const finalScene = page.locator('[data-scene-image="connections.context"]:visible');
  await page.waitForTimeout(4_000);
  await expect(finalScene).toHaveAttribute('data-image-state', 'loading');

  await finalScene.scrollIntoViewIfNeeded();
  await expect(finalScene).toHaveAttribute('data-image-state', 'ready');
});

test('takeover, guided, and Explore states remain visually stable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/demo?scene=review.question&layout=desktop');
  await waitForScene(page);
  await expect(page).toHaveScreenshot('simulator-takeover.png', {
    animations: 'disabled',
    caret: 'hide',
  });

  await page.getByRole('button', { name: 'Show Answer', exact: true }).click();
  await expect(page.locator('[data-showcase-simulator]')).toHaveAttribute(
    'data-stage',
    'review.answer',
  );
  await expect(page).toHaveScreenshot('simulator-guided.png', {
    animations: 'disabled',
    caret: 'hide',
  });

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(page.locator('[data-showcase-simulator]')).toHaveAttribute('data-mode', 'explore');
  await expect(page).toHaveScreenshot('simulator-explore.png', {
    animations: 'disabled',
    caret: 'hide',
  });
});

test('reduced motion keeps the same guided state without spatial transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo?scene=review.answer&layout=mobile');
  await waitForScene(page);

  await expect(page).toHaveScreenshot('simulator-reduced-motion-phone.png', {
    animations: 'disabled',
    caret: 'hide',
  });
});

test('loading and failed assets preserve a complete simulator frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/library.ready--desktop--*', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.fulfill({ response });
  });
  await page.goto('/demo', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-image-state="loading"]')).toBeVisible();
  await expect(page).toHaveScreenshot('simulator-loading.png', {
    animations: 'disabled',
    caret: 'hide',
  });

  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/library.ready--desktop--*', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.reload();
  await expect(page.getByText('The product scene could not be loaded.', { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('simulator-asset-failure.png', {
    animations: 'disabled',
    caret: 'hide',
  });
});
