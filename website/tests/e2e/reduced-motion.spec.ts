import { test, expect } from '@playwright/test';

test('reduced motion disables infinite mascot animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const mascot = page.locator('[data-testid="mascot"], [data-mascot], [data-peck-scene], .peck-bird');
  if ((await mascot.count()) === 0) {
    test.skip(true, 'Mascot not mounted — waiting on change B');
    return;
  }

  const infinite = await mascot.evaluateAll((nodes) => {
    const visit = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.animationIterationCount.split(',').some((value) => value.trim() === 'infinite')) {
        return true;
      }
      return [...el.children].some(visit);
    };
    return nodes.some(visit);
  });

  expect(infinite).toBe(false);
});
