import { expect, test, type Page } from '@playwright/test';

async function openReader(page: Page, theme = 'biolume-abyss'): Promise<void> {
  await page.goto(`/scholarly-reader-harness.html?theme=${theme}`);
  await page.locator('#scholarly-reader-shell[data-ready="true"]').waitFor();
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame');
    const image = frame?.contentDocument?.querySelector<HTMLImageElement>('figure img');
    return Boolean(frame?.contentDocument?.querySelector('#html-viewer-styles')) && Boolean(image?.complete);
  });
}

test.describe('canonical scholarly reader computed contract', () => {
  test('contrast, semantics, measure, focus, figure, and zoom remain readable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openReader(page, 'biolume-abyss');

    const desktop = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame')!;
      const doc = frame.contentDocument!;
      const win = frame.contentWindow!;
      const rgb = (value: string): [number, number, number] => {
        const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return [values[0], values[1], values[2]];
      };
      const luminance = ([r, g, b]: [number, number, number]) => {
        const channel = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const ratio = (foreground: string, background: string) => {
        const a = luminance(rgb(foreground));
        const b = luminance(rgb(background));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const body = getComputedStyle(doc.body);
      const link = getComputedStyle(doc.querySelector('a[href]')!);
      const caption = getComputedStyle(doc.querySelector('figcaption')!);
      const muted = getComputedStyle(doc.querySelector('.inc-byline')!);
      const strong = getComputedStyle(doc.querySelector('strong')!);
      const emphasis = getComputedStyle(doc.querySelector('em')!);
      const sectionH2 = Array.from(doc.querySelectorAll('h2')).find(
        (heading) => !heading.closest('.inc-abstract')
      )!;
      const headings = [sectionH2, doc.querySelector('h3')!, doc.querySelector('h4')!].map(
        (heading) => Number.parseFloat(getComputedStyle(heading).fontSize)
      );
      const article = doc.querySelector<HTMLElement>('.inc-article')!;
      const articleRect = article.getBoundingClientRect();
      const probe = doc.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:66ch;font:inherit';
      doc.body.appendChild(probe);
      const expectedMeasure = probe.getBoundingClientRect().width;
      probe.remove();
      const imageRect = doc.querySelector('figure img')!.getBoundingClientRect();
      const figureRect = doc.querySelector('figure')!.getBoundingClientRect();
      const focusTarget = doc.querySelector<HTMLAnchorElement>('a[href]')!;
      focusTarget.focus();
      const focus = getComputedStyle(focusTarget);
      return {
        bodyContrast: ratio(body.color, body.backgroundColor),
        linkContrast: ratio(link.color, body.backgroundColor),
        captionContrast: ratio(caption.color, body.backgroundColor),
        mutedContrast: ratio(muted.color, body.backgroundColor),
        foreground: body.color,
        linkToken: getComputedStyle(doc.documentElement).getPropertyValue('--reader-link').trim(),
        strongWeight: Number.parseInt(strong.fontWeight, 10),
        emphasisStyle: emphasis.fontStyle,
        headings,
        articleWidth: articleRect.width,
        expectedMeasure,
        articleCentered: Math.abs(articleRect.left - (win.innerWidth - articleRect.width) / 2),
        figureContained:
          imageRect.left >= figureRect.left - 1 && imageRect.right <= figureRect.right + 1,
        focusOutlineWidth: Number.parseFloat(focus.outlineWidth),
        focusOutlineStyle: focus.outlineStyle,
        rootOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
      };
    });

    expect(desktop.bodyContrast).toBeGreaterThanOrEqual(4.5);
    expect(desktop.linkContrast).toBeGreaterThanOrEqual(4.5);
    expect(desktop.captionContrast).toBeGreaterThanOrEqual(4.5);
    expect(desktop.mutedContrast).toBeGreaterThanOrEqual(4.5);
    expect(desktop.strongWeight).toBeGreaterThanOrEqual(700);
    expect(desktop.emphasisStyle).toBe('italic');
    expect(desktop.headings[0]).toBeGreaterThan(desktop.headings[1]);
    expect(desktop.headings[1]).toBeGreaterThan(desktop.headings[2]);
    expect(Math.abs(desktop.articleWidth - desktop.expectedMeasure)).toBeLessThanOrEqual(1);
    expect(desktop.articleCentered).toBeLessThanOrEqual(1);
    expect(desktop.figureContained).toBe(true);
    expect(desktop.focusOutlineWidth).toBeGreaterThanOrEqual(3);
    expect(desktop.focusOutlineStyle).not.toBe('none');
    expect(desktop.rootOverflow).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      window.__scholarlyReaderHarness.setTheme('modern-dark');
      window.__scholarlyReaderHarness.setTypography({ fontSize: 32 });
    });
    await page.setViewportSize({ width: 520, height: 820 });
    const narrow = await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame')!.contentDocument!;
      const article = doc.querySelector<HTMLElement>('.inc-article')!;
      return {
        articleWidth: article.getBoundingClientRect().width,
        viewportWidth: doc.documentElement.clientWidth,
        rootOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
        linkToken: getComputedStyle(doc.documentElement).getPropertyValue('--reader-link').trim(),
      };
    });
    expect(narrow.articleWidth).toBeLessThan(narrow.viewportWidth);
    expect(narrow.rootOverflow).toBeLessThanOrEqual(1);
    expect(narrow.linkToken).toBe('#7ab4ff');
  });

  test('oversized equation and table scroll locally without widening the root', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 820 });
    await openReader(page, 'snow');
    const geometry = await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame')!.contentDocument!;
      const equation = doc.querySelector<HTMLElement>('.inc-equation')!;
      const tableWrap = doc.querySelector<HTMLElement>('.inc-table-wrap')!;
      const article = doc.querySelector<HTMLElement>('.inc-article')!;
      return {
        equationOverflow: equation.scrollWidth - equation.clientWidth,
        tableOverflow: tableWrap.scrollWidth - tableWrap.clientWidth,
        equationTabIndex: equation.getAttribute('tabindex'),
        tableTabIndex: tableWrap.getAttribute('tabindex'),
        tableSemantic: tableWrap.firstElementChild?.tagName,
        articleOverflow: article.scrollWidth - article.clientWidth,
        bodyOverflow: doc.body.scrollWidth - doc.body.clientWidth,
        rootOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
      };
    });
    expect(geometry.equationOverflow).toBeGreaterThan(0);
    expect(geometry.tableOverflow).toBeGreaterThan(0);
    expect(geometry.equationTabIndex).toBe('0');
    expect(geometry.tableTabIndex).toBe('0');
    expect(geometry.tableSemantic).toBe('TABLE');
    expect(geometry.articleOverflow).toBeLessThanOrEqual(1);
    expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
    expect(geometry.rootOverflow).toBeLessThanOrEqual(1);
  });

  test('committed and preview theme changes update one style node in place', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openReader(page, 'snow');
    await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame')!;
      const win = frame.contentWindow! as Window & Record<string, unknown>;
      const doc = frame.contentDocument!;
      win.__readerDocument = doc;
      win.__readerArticle = doc.querySelector('.inc-article');
      win.__readerStyle = doc.querySelector('#html-viewer-styles');
      win.__readerText = doc.body.textContent;
      const strongText = doc.querySelector('strong')!.firstChild!;
      const range = doc.createRange();
      range.selectNodeContents(strongText);
      const selection = win.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      win.scrollTo(0, 500);
      win.__readerScroll = win.scrollY;
      win.__readerSelection = selection.toString();
      win.__readerToken = getComputedStyle(doc.documentElement).getPropertyValue('--reader-background');
    });

    await page.evaluate(() => window.__scholarlyReaderHarness.setTheme('biolume-abyss'));
    await page.evaluate(() => window.__scholarlyReaderHarness.setPreviewTheme('modern-dark'));

    const state = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('#scholarly-reader-frame')!;
      const win = frame.contentWindow! as Window & Record<string, unknown>;
      const doc = frame.contentDocument!;
      return {
        sameDocument: doc === win.__readerDocument,
        sameArticle: doc.querySelector('.inc-article') === win.__readerArticle,
        sameStyle: doc.querySelector('#html-viewer-styles') === win.__readerStyle,
        sameText: doc.body.textContent === win.__readerText,
        selection: win.getSelection()?.toString(),
        expectedSelection: win.__readerSelection,
        scrollDelta: Math.abs(win.scrollY - Number(win.__readerScroll)),
        tokenChanged:
          getComputedStyle(doc.documentElement).getPropertyValue('--reader-background') !==
          win.__readerToken,
        styleCount: doc.querySelectorAll('#html-viewer-styles').length,
      };
    });
    expect(state).toMatchObject({
      sameDocument: true,
      sameArticle: true,
      sameStyle: true,
      sameText: true,
      styleCount: 1,
      tokenChanged: true,
    });
    expect(state.selection).toBe(state.expectedSelection);
    expect(state.scrollDelta).toBeLessThanOrEqual(1);
  });
});

const SCREENSHOTS = [
  { name: 'biolume-abyss-desktop', theme: 'biolume-abyss', width: 1280, height: 900 },
  { name: 'snow-light-desktop', theme: 'snow', width: 1280, height: 900 },
  { name: 'modern-dark-assistant-width', theme: 'modern-dark', width: 820, height: 900 },
  { name: 'snow-tablet', theme: 'snow', width: 768, height: 1024 },
] as const;

test.describe('canonical scholarly reader visual baselines', () => {
  for (const shot of SCREENSHOTS) {
    test(`${shot.name}`, async ({ page }) => {
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await openReader(page, shot.theme);
      await expect(page.locator('#scholarly-reader-frame')).toHaveScreenshot(
        `scholarly-reader-${shot.name}.png`
      );
    });
  }
});
