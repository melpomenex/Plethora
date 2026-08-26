import { test, expect } from '@playwright/test';
import { THEMATIC_META_COLORS } from '../../src/config/theme.ts';

const LIGHT_PAPER_BG = 'rgb(243, 240, 232)'; // --paper #f3f0e8
const DARK_PAPER_BG = 'rgb(20, 16, 26)'; // --paper #14101a

/**
 * Theme bootstrap contract (refine-useplethora-visual-product-storytelling):
 * first visit renders Light regardless of OS preference, stored explicit
 * choices always win, and everything applies pre-paint via the head script.
 */
test.describe('theme bootstrap', () => {
  test.describe('dark-mode OS, no stored preference', () => {
    test.use({ colorScheme: 'dark' });

    test('first visit lands on Light with correct chrome tint', async ({ page }) => {
      await page.goto('/');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(root).toHaveAttribute('data-effective-theme', 'light');

      const background = await root.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).toBe(LIGHT_PAPER_BG);
      await expect(page.locator('#meta-theme-color')).toHaveAttribute(
        'content',
        THEMATIC_META_COLORS.light,
      );

      // First visit must not manufacture a preference.
      const stored = await page.evaluate(() => localStorage.getItem('plethora-theme'));
      expect(stored).toBeNull();
    });

    test('stored Auto still follows the dark OS preference', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('plethora-theme', 'system');
      });
      await page.goto('/');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme', 'system');
      await expect(root).toHaveAttribute('data-effective-theme', 'dark');
      const background = await root.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).toBe(DARK_PAPER_BG);
      await expect(page.locator('#meta-theme-color')).toHaveAttribute(
        'content',
        THEMATIC_META_COLORS.dark,
      );
    });
  });

  test.describe('light-mode OS', () => {
    test.use({ colorScheme: 'light' });

    test('stored explicit Dark applies exactly, without a light flash state', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('plethora-theme', 'dark');
      });
      await page.goto('/');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(root).toHaveAttribute('data-effective-theme', 'dark');
      const background = await root.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background).toBe(DARK_PAPER_BG);
    });

    test('selecting a theme writes it explicitly and updates chrome tint', async ({ page }) => {
      await page.goto('/');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme', 'light');

      await page.locator('[data-theme-set="dark"]').click();
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('#meta-theme-color')).toHaveAttribute(
        'content',
        THEMATIC_META_COLORS.dark,
      );
      const stored = await page.evaluate(() => localStorage.getItem('plethora-theme'));
      expect(stored).toBe('dark');

      await page.locator('[data-theme-set="system"]').click();
      // Selecting Auto stores the literal value rather than clearing the key.
      const storedAuto = await page.evaluate(() => localStorage.getItem('plethora-theme'));
      expect(storedAuto).toBe('system');
      await expect(root).toHaveAttribute('data-theme', 'system');
      await expect(root).toHaveAttribute('data-effective-theme', 'light');
    });

    test('OS preference changes apply live while Auto is selected', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('plethora-theme', 'system');
      });
      await page.goto('/');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-effective-theme', 'light');

      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(root).toHaveAttribute('data-effective-theme', 'dark');
      await expect(page.locator('#meta-theme-color')).toHaveAttribute(
        'content',
        THEMATIC_META_COLORS.dark,
      );

      // Explicit choices ignore OS flips.
      await page.locator('[data-theme-set="light"]').click();
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(root).toHaveAttribute('data-effective-theme', 'light');
    });
  });
});
