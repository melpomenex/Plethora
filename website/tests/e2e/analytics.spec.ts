import { test, expect } from '@playwright/test';

test('analytics stay off unless PUBLIC_ANALYTICS_ENABLED is set', async ({ page }) => {
  const blocked = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      /plausible\.io|googletagmanager|google-analytics|segment\.com|mixpanel|amplitude/i.test(url)
    ) {
      blocked.push(url);
    }
  });
  await page.goto('/');
  await page.waitForLoadState('load');
  expect(blocked, blocked.join('\n')).toEqual([]);
});
