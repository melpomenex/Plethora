import { test, expect } from '@playwright/test';

test('device frames reserve width/height or aspect-ratio', async ({ page }) => {
  await page.goto('/');
  const frames = page.locator('[data-testid="device-frame"], [data-device-frame], .device-frame');
  if ((await frames.count()) === 0) {
    test.skip(true, 'No device frames yet — waiting on change B/C');
    return;
  }

  const missing = await frames.evaluateAll((nodes) =>
    nodes
      .map((el) => {
        const style = getComputedStyle(el);
        const hasAspect = style.aspectRatio && style.aspectRatio !== 'auto';
        const img = el.matches('img') ? (el as HTMLImageElement) : el.querySelector('img');
        const hasHw = Boolean(img && img.getAttribute('width') && img.getAttribute('height'));
        return hasAspect || hasHw ? null : el.outerHTML.slice(0, 120);
      })
      .filter(Boolean),
  );

  expect(missing, missing.join('\n')).toEqual([]);
});
