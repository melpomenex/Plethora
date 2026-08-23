import { test, expect } from '@playwright/test';
import { SITE_ROUTES } from '../../src/config/routes.ts';

test('preview/noindex invariant: documents and robots disallow indexing', async ({ page, request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  const robotsBody = await robots.text();
  expect(robotsBody).toMatch(/Disallow:\s*\//);

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).not.toMatch(/<loc>/);

  for (const route of SITE_ROUTES.slice(0, 8)) {
    await page.goto(route.path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  }
});
