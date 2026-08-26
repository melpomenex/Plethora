import { test, expect } from '@playwright/test';

test('short initial viewport does not request the showcase island or later scenes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 500 });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await page.goto('/');
  await page.waitForTimeout(500);

  expect(requested.some((url) => /DemoIsland\.[^.]+\.js/.test(url))).toBe(false);
  expect(
    requested.some((url) =>
      /\/(reader\.|remember\.|review\.|connections\.)[^/]*--(?:desktop|mobile)--/.test(url),
    ),
    requested.filter((url) => /showcase\/v2/.test(url)).join('\n'),
  ).toBe(false);

  // Secondary hero CTA: label varies by launch flag ("Try the interactive demo"
  // when downloads are enabled, "See what it does" otherwise) — target the hook.
  await page.locator('a[data-cta="try-demo"]').first().click();
  await expect(page.locator('[data-demo-island]')).toBeInViewport();
  await expect.poll(() => requested.some((url) => /DemoIsland\.[^.]+\.js/.test(url))).toBe(true);
});
