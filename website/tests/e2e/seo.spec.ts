import { test, expect } from '@playwright/test';
import { SITE_ROUTES } from '../../src/config/routes.ts';

test('titles are unique; canonical and OG tags are present', async ({ page, request }) => {
  const titles = new Set<string>();
  for (const route of SITE_ROUTES) {
    const response = await page.goto(route.path);
    expect(response?.status(), route.path).toBe(200);
    const title = await page.title();
    expect(title.length, route.path).toBeGreaterThan(0);
    expect(titles.has(title), `duplicate title "${title}" on ${route.path}`).toBe(false);
    titles.add(title);

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', /https?:\/\//);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', /.+/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', /https?:\/\//);
  }

  const home = await request.get('/');
  expect(home.status()).toBe(200);
});
