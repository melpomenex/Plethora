import { test, expect } from '@playwright/test';
import { SITE_ROUTES } from '../../src/config/routes.ts';

const iaPaths = SITE_ROUTES.map((route) => route.path);

test.describe('IA smoke', () => {
  for (const path of iaPaths) {
    test(`${path} returns 200`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
    });
  }

  test('/pricing exposes Free and Pro once E lands (stub-safe)', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);
    const stub = page.locator('[data-owner="E"]');
    if ((await stub.count()) > 0) {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      test.info().annotations.push({
        type: 'skip-detail',
        description: 'Pricing is still an owner stub; Free/Pro comparison waits on change E.',
      });
      return;
    }
    await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pro/ })).toBeVisible();
  });

  test('primary nav remains intact on home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('site-nav')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });
});
