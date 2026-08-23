import { test, expect } from '@playwright/test';

test('keyboard-only demo path', async ({ page }) => {
  await page.goto('/');
  const slot = page.locator('#demo, [data-home-demo-slot], [data-testid="home-demo-slot"]').first();
  if ((await slot.count()) === 0) {
    test.skip(true, 'Demo slot not mounted');
    return;
  }

  await slot.scrollIntoViewIfNeeded();
  const island = slot.locator('[data-demo-island]');
  const controls = slot.locator(
    'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );

  if ((await island.count()) === 0 && (await controls.count()) === 0) {
    test.skip(true, 'Demo slot empty — waiting on change D');
    return;
  }

  await island.first().waitFor({ state: 'visible' });
  await slot.locator('.demo-btn-primary, button.demo-card-btn').first().focus();

  for (let i = 0; i < 16; i++) {
    if ((await slot.locator('[data-stage="review-rate"]').count()) > 0) break;
    await page.keyboard.press('ArrowRight');
  }

  const good = slot.getByRole('button', { name: 'Good' });
  if ((await good.count()) > 0) {
    await good.focus();
    await page.keyboard.press('Space');
  }

  for (let i = 0; i < 6; i++) {
    if ((await slot.locator('[data-stage="complete"]').count()) > 0) break;
    await page.keyboard.press('ArrowRight');
  }

  await expect(slot.locator('[data-stage="complete"]')).toBeVisible();
});
