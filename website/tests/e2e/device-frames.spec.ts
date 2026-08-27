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


test('hero stage children keep CLS-safe sizing', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(() => {
    const stage = document.querySelector('.hero-stage');
    if (!stage) return { present: false };
    const desk = stage.querySelector<HTMLElement>('.stage-desk');
    const phone = stage.querySelector<HTMLElement>('.phone-device');
    const screen = stage.querySelector<HTMLElement>('.phone-screen');
    const safe = (el: HTMLElement | null) => {
      if (!el) return 'missing';
      const style = getComputedStyle(el);
      const hasAspect = style.aspectRatio && style.aspectRatio !== 'auto';
      const img = el.querySelector('img');
      const hasHw = Boolean(img?.getAttribute('width') && img?.getAttribute('height'));
      return hasAspect || hasHw ? 'ok' : 'unsized';
    };
    return {
      present: true,
      desk: safe(desk),
      phone: safe(phone),
      screen: safe(screen),
    };
  });

  expect(report.present, 'hero stage present on homepage').toBe(true);
  expect(report.desk).toBe('ok');
  expect(report.phone).toBe('ok');
  expect(report.screen).toBe('ok');
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`phone frames preserve the full screenshot at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    const frames = await page.locator('.phone-screen').evaluateAll((screens) =>
      screens.map((screen) => {
        const image = screen.querySelector('img');
        if (!image) return { error: 'missing image' };

        const intrinsicWidth = image.naturalWidth || Number(image.getAttribute('width'));
        const intrinsicHeight = image.naturalHeight || Number(image.getAttribute('height'));
        return {
          sourceAspect: intrinsicWidth / intrinsicHeight,
          screenAspect: screen.clientWidth / screen.clientHeight,
          imageAspect: image.clientWidth / image.clientHeight,
          objectFit: getComputedStyle(image).objectFit,
        };
      }),
    );

    expect(frames.length, 'hero and Reading section phone frames').toBe(2);
    for (const frame of frames) {
      expect(frame).not.toHaveProperty('error');
      if ('error' in frame) continue;
      expect(frame.objectFit).toBe('contain');
      expect(Math.abs(frame.screenAspect - frame.sourceAspect)).toBeLessThan(0.003);
      expect(Math.abs(frame.imageAspect - frame.sourceAspect)).toBeLessThan(0.003);
    }
  });
}

const WIDTHS = [320, 390, 768, 1024, 1280, 1440, 1728];

test.describe('document overflow regression', () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      expect(
        overflow.scrollWidth - overflow.clientWidth,
        `document scrollWidth ${overflow.scrollWidth} vs clientWidth ${overflow.clientWidth} at ${width}px`,
      ).toBeLessThanOrEqual(0);

      // The hero's rotated devices must stay inside the clipped viewport too.
      const heroBleed = await page.evaluate(() => {
        const hero = document.querySelector('.home-hero');
        if (!hero) return 0;
        const rect = hero.getBoundingClientRect();
        return Math.max(0, Math.round(rect.right - window.innerWidth));
      });
      expect(heroBleed, `hero extends ${heroBleed}px past the viewport at ${width}px`).toBeLessThanOrEqual(0);
    });
  }
});
