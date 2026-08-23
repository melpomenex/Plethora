import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const axeRoutes = ['/', '/demo', '/pricing', '/downloads', '/privacy', '/features'];

test.describe('axe WCAG 2.2 AA', () => {
  for (const path of axeRoutes) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
      const serious = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });
  }
});
