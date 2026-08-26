import { test, expect } from '@playwright/test';

test.describe('header chrome', () => {
  test('desktop composition: five product links, no Downloads duplication, distinct CTA', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const navLinks = page.getByTestId('site-nav').locator('a');
    await expect(navLinks).toHaveCount(5);
    const labels = (await navLinks.allTextContents()).map((label) => label.trim());
    expect(labels).toEqual(['Features', 'How it works', 'Pricing', 'Demo', 'Docs']);

    const cta = page.locator('[data-testid="site-header"] a[data-cta="get-plethora"]');
    await expect(cta).toHaveText(/Get Plethora/);

    // Downloads stays reachable from the footer, not the primary links.
    const footer = page.getByTestId('site-footer');
    await expect(footer.getByRole('link', { name: 'Downloads' })).toBeAttached();
  });

  test('stuck treatment engages after the hero without layout shift', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('plethora-theme', 'light'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const header = page.locator('[data-testid="site-header"]');
    await expect(header).not.toHaveClass(/is-stuck/);

    const before = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="site-header"]')!;
      const main = document.querySelector('[data-testid="site-main"]')!;
      return {
        headerHeight: h.getBoundingClientRect().height,
        mainTop: main.getBoundingClientRect().top + window.scrollY,
      };
    });

    await page.evaluate(() => {
      const hero = document.querySelector('#hero')!;
      const bottom = hero.getBoundingClientRect().bottom + window.scrollY;
      window.scrollTo(0, bottom + 10); // fully past the hero sentinel
    });
    await expect(header).toHaveClass(/is-stuck/, { timeout: 2000 });

    const after = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="site-header"]')!;
      const main = document.querySelector('[data-testid="site-main"]')!;
      return {
        headerHeight: h.getBoundingClientRect().height,
        mainTop: main.getBoundingClientRect().top + window.scrollY,
        backgroundColor: getComputedStyle(h).backgroundColor,
        boxShadow: getComputedStyle(h).boxShadow,
      };
    });

    expect(Math.abs(after.headerHeight - before.headerHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.mainTop - before.mainTop)).toBeLessThanOrEqual(1);
    expect(after.backgroundColor).not.toBe('rgb(243, 240, 232)'); // translucent mix engaged
    expect(after.boxShadow).not.toBe('none');
  });

  test('theme control: compact height, keyboard operable, visible selection', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('plethora-theme', 'light'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const group = page.locator('[data-testid="theme-toggle"] fieldset');
    const height = await group.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(44);

    // Walk focus from the brand mark to the theme group using Tab only.
    await page.locator('.site-mark').focus();
    let reached = false;
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inToggle = await page.evaluate(() =>
        Boolean(
          document.activeElement?.closest('[data-testid="theme-toggle"] fieldset'),
        ),
      );
      if (inToggle) {
        reached = true;
        break;
      }
    }
    expect(reached, 'keyboard reaches the theme control').toBe(true);

    const focused = page.locator('[data-testid="theme-toggle"] button:focus');
    await expect(focused).toHaveAttribute('data-theme-set', 'light');

    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none'); // visible keyboard focus

    await page.keyboard.press('Tab'); // Auto
    await page.keyboard.press('Tab'); // Dark
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => localStorage.getItem('plethora-theme'));
    expect(stored).toBe('dark');
    await expect(page.locator('[data-theme-set="dark"]')).toHaveAttribute('aria-pressed', 'true');
  });
});
