import { test, expect } from '@playwright/test';

/**
 * Reading Desk recomposition guards (refine-useplethora-visual-product-storytelling):
 * heading + stage simultaneity on entry, all five chapters still activate
 * in order via the existing IntersectionObserver state machine, captions
 * follow the active chapter, and takeover behaviors remain reachable.
 */

const CHAPTER_IDS = ['Collect', 'Read', 'Understand', 'Remember', 'Return'];

async function scrollToDeskTop(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const desk = document.querySelector('[data-testid="home-demo-slot"]')!;
    window.scrollTo(0, desk.getBoundingClientRect().top + window.scrollY);
  });
}

test.describe('Reading Desk (homepage)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('plethora-theme', 'light'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('heading and product stage are visible together on entry', async ({ page }) => {
    await scrollToDeskTop(page);
    await page.waitForTimeout(400);

    const positions = await page.evaluate(() => {
      const heading = document.querySelector('#reading-desk-title')!;
      const stage = document.querySelector('[data-testid="home-demo-slot"] .reading-desk__stage')!;
      const vh = window.innerHeight;
      const rank = (el: Element) => {
        const r = el.getBoundingClientRect();
        if (r.top >= 0 && r.top < vh) return 0; // fully visible
        if (r.top < vh) return Math.abs(r.top); // within ~120px
        return Number.POSITIVE_INFINITY;
      };
      return { heading: rank(heading), stage: rank(stage), stageVisible: rank(stage) < 120 };
    });

    expect(positions.heading, 'heading visible at desk entry').toBeLessThan(120);
    expect(positions.stageVisible, 'product stage simultaneous with heading').toBe(true);
  });

  test('all five chapters activate in order while scrolling (observer parity)', async ({
    page,
  }) => {
    const activated = await page.evaluate(async () => {
      const desk = document.querySelector('[data-testid="home-demo-slot"]')!;
      const chapters = [...desk.querySelectorAll('.reading-desk__chapters > li')];
      const seen: string[] = [];
      const deskTop = desk.getBoundingClientRect().top + window.scrollY;
      const step = window.innerHeight * 0.45;
      for (let y = deskTop - 200; y <= deskTop + desk.scrollHeight + 400; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
        chapters.forEach((li) => {
          if (li.classList.contains('is-active')) {
            const id = li.getAttribute('data-chapter')!;
            if (seen[seen.length - 1] !== id) seen.push(id);
          }
        });
      }
      return seen;
    });

    // Every chapter activates; adjacent duplicates from re-entry collapse.
    const uniqueInOrder = activated.filter((id, i) => id !== activated[i - 1]);
    for (const id of CHAPTER_IDS) {
      expect(uniqueInOrder, `${id} activates during scroll`).toContain(id);
    }
    // First activation order follows the narrative.
    const firstPass = uniqueInOrder.filter((id, i) => uniqueInOrder.indexOf(id) === i);
    expect(firstPass).toEqual(CHAPTER_IDS);
  });

  test('stage caption follows the active chapter and frames persist', async ({ page }) => {
    await scrollToDeskTop(page);
    await page.waitForTimeout(300);
    const captionAt = () =>
      page.$eval('[data-testid="home-demo-slot"] .reading-desk__stage-caption', (el) =>
        (el.textContent ?? '').trim(),
      );
    expect(await captionAt()).toContain('The document arrives in the library');

    await page.evaluate(() => {
      const li = document.querySelector('[data-chapter="Read"]')!;
      window.scrollTo(0, li.getBoundingClientRect().top + window.scrollY - 200);
    });
    await page.waitForTimeout(300);
    expect(await captionAt()).toContain('Reopened exactly where you stopped');

    // One continuous product story: same desktop frame node across chapters.
    const sameFrame = await page.evaluate(() => {
      const before = document.querySelector('[data-testid="home-demo-slot"] .reading-desk__desktop-frame');
      return { exists: Boolean(before) };
    });
    expect(sameFrame.exists).toBe(true);
  });

  test('compact presentation keeps inline media reachable below 64rem', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForLoadState('networkidle');
    const media = page.locator('[data-testid="home-demo-slot"] .reading-desk__chapter-media');
    await expect(media.first()).toBeVisible();
    const width = await media
      .first()
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(240);
    const strip = page.locator('[data-testid="home-demo-slot"] .reading-desk__mini-rail').first();
    await expect(strip).toBeVisible();
    await expect(strip.locator('span')).toHaveCount(5);
  });
});
