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

test('reduced motion keeps showcase outcomes without pulsing or spatial transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/demo');
  const hotspot = page.getByRole('button', { name: 'Open / Read', exact: true });
  await expect(hotspot).toBeVisible();
  await expect(hotspot).toHaveCSS('animation-name', 'none');
  await hotspot.click();
  await expect(page.locator('[data-showcase-simulator]')).toHaveAttribute('data-stage', 'reader.open');
});
