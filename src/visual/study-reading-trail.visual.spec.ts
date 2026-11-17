import { expect, test, type Page } from '@playwright/test';
import { first } from './fixtures/study-reading-sources';
import { GUIDED_READING_HIGHLIGHT } from '../lib/study-plans/reading/paintReadingPassage';

test.use({ launchOptions: { executablePath: process.env.PLETHORA_TEST_CHROMIUM }, actionTimeout: 12000 });
const harness = '/src/visual/entries/study-reading-trail-harness.html';
const exactDescription = 'Read from the single underline to the double underline.';
const readingTrigger = (page: Page) => page.getByRole('button', { name: 'Guided Reading', exact: true });

async function openReadingMenu(page: Page) {
  await readingTrigger(page).click();
  const menu = page.getByRole('menu', { name: 'Guided Reading' });
  await expect(menu.locator('[role="menuitem"]:enabled').first()).toBeFocused();
  return menu;
}

async function highlightedSourceText(page: Page) {
  const ranges = await Promise.all(page.frames().map((frame) => frame.evaluate(() => {
    return [...CSS.highlights.entries()].flatMap(([name, highlight]) =>
      /^study-passage-\d+$/.test(name) ? [...highlight].map((range) => String(range)) : []);
  }).catch(() => [])));
  return ranges.flat();
}

async function visiblePassageHighlights(page: Page) {
  const inReaders = await Promise.all(page.frames().map((frame) => frame.evaluate(() => {
    return [...CSS.highlights.entries()].flatMap(([name, highlight]) => {
      if (!/^study-passage-\d+$/.test(name)) return [];
      return [...highlight].map((range) => ({
        text: String(range),
        fill: getComputedStyle(range.startContainer.parentElement!, `::highlight(${name})`).backgroundColor,
      }));
    });
  }).catch(() => [])));
  const geometry = await page.locator('[data-study-decoration] span').evaluateAll((marks) =>
    marks.map((mark) => ({
      text: '',
      fill: getComputedStyle(mark).backgroundColor,
      outline: getComputedStyle(mark).boxShadow,
    })),
  );
  return [...inReaders.flat(), ...geometry];
}

for (const format of ['epub', 'pdf', 'html', 'markdown']) {
  test(`${format} verifies and clears an actual rendered passage`, async ({ page }, testInfo) => {
    await page.goto(`${harness}?format=${format}`);
    await expect(page.getByTestId('status')).toHaveText('exact', { timeout: 25000 });
    await expect(readingTrigger(page)).toHaveAccessibleDescription(exactDescription);
    await expect(page.getByRole('menu', { name: 'Guided Reading' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Guided Reading' })).toHaveCount(0);
    await expect(page.locator('blockquote')).toHaveCount(0);
    if (format === 'pdf') {
      await expect(page.locator('[data-study-decoration]')).not.toHaveCount(0);
      await page.locator('.textLayer').getByText('across two majorities.').evaluate((span) => {
        span.replaceChildren(span.ownerDocument.createTextNode(span.textContent ?? ''));
      });
      await expect(page.locator('[data-study-decoration] span[style*="background"]')).toHaveCount(2);
      await page.getByRole('button', { name: 'Zoom PDF' }).click();
      await expect(page.locator('[data-study-decoration]')).not.toHaveCount(0);
    } else {
      await expect.poll(() => highlightedSourceText(page)).toContain(first);
    }
    await expect.poll(async () => {
      const highlights = await visiblePassageHighlights(page);
      return highlights.some(({ text, fill, outline }) =>
        (text.includes(first) && fill === GUIDED_READING_HIGHLIGHT.fill) ||
        (fill === GUIDED_READING_HIGHLIGHT.fill && outline.includes(GUIDED_READING_HIGHLIGHT.outline)),
      );
    }).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${format}-reading.png`) });
    await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Exit Study Mode' }).click();
    await expect(readingTrigger(page)).toHaveCount(0);
    await expect(page.locator('[data-study-decoration]')).toHaveCount(0);
    await expect.poll(() => highlightedSourceText(page)).toEqual([]);
    await page.getByRole('button', { name: 'Restart passage' }).click();
    await expect(page.getByTestId('status')).toHaveText('exact');
  });
}

test('quote-only EPUB rejects duplicate text across chapters', async ({ page }) => {
  await page.goto(`${harness}?format=epub&ambiguous`);
  await expect(page.getByTestId('status')).toHaveText('ambiguous', { timeout: 25000 });
});

test('a PDF page without text offers only a nearby location', async ({ page }) => {
  await page.goto(`${harness}?format=pdf&scanned`);
  await expect(page.getByTestId('status')).toHaveText('coarse', { timeout: 25000 });
  await expect(readingTrigger(page)).toHaveAccessibleDescription('Only an approximate location is available.');
  await expect((await openReadingMenu(page)).getByRole('menuitem', { name: 'Open nearby location' })).toBeVisible();
  await expect(page.locator('blockquote')).toHaveCount(0);
});

test('a virtualized PDF repaints the verified end boundary when it mounts', async ({ page }) => {
  await page.goto(`${harness}?format=pdf&virtualized`);
  await expect(page.getByTestId('status')).toHaveText('exact', { timeout: 25000 });
  await expect(page.locator('.textLayer').getByText('The second passage closes with a verified boundary.')).toHaveCount(0);
  await page.getByRole('button', { name: 'View end page' }).click();
  await expect(page.locator('.textLayer').getByText('The second passage closes with a verified boundary.')).toBeVisible();
  await expect(page.locator('[data-study-decoration] span[style*="double"]')).toHaveCount(1);
});

test('a published plan prepares, resumes across four readers, and reviews a missed question', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/src/visual/entries/study-reading-flow-harness.html');
  const trail = page.getByRole('region', { name: 'Guided Reading' }).filter({ visible: true });
  const trigger = readingTrigger(page);
  const openMenu = () => openReadingMenu(page);
  const choose = async (name: string) => (await openMenu()).getByRole('menuitem', { name, exact: true }).click();

  await page.getByRole('button', { name: 'Start Guided Reading', exact: true }).click();
  await expect(trigger).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
  await expect.poll(() => highlightedSourceText(page)).toContain(first);
  const menu = await openMenu();
  await expect(menu.getByRole('menuitem', { name: 'Next passage' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Mark passage complete' }).click();
  await choose('Quick check');
  await expect(page.getByText(/Practice request: practice · 3 · source-only/)).toBeVisible();
  await page.getByRole('button', { name: 'Start fixture practice' }).click();
  await expect(page.getByText('The passage describes overlap.')).toHaveCount(0);
  await page.getByText('Yes', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Yes', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText('The passage describes overlap.')).toBeVisible();
  await page.getByRole('button', { name: 'Exit assessment' }).click();

  await page.getByRole('button', { name: 'Continue Reading', exact: true }).click();
  await expect(trigger).toHaveAccessibleDescription(exactDescription);
  for (const format of ['HTML', 'EPUB', 'PDF']) {
    await choose('Next passage');
    await expect(page.getByText(`Fixture ${format}`, { exact: true }).filter({ visible: true })).not.toHaveCount(0);
    await expect(trigger).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
    if (format !== 'PDF') await choose('Mark passage complete');
  }
  await page.screenshot({ path: testInfo.outputPath('desktop-plan-reading.png') });

  await page.reload();
  await page.getByRole('button', { name: 'Continue Reading', exact: true }).click();
  await expect(trigger).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
  await expect(page.locator('[data-study-decoration]')).not.toHaveCount(0);
  await expect((await openMenu()).getByText('3 of 4 passages completed')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Return to Study Plan' }).click();

  await page.getByText('Reading assignments', { exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Fixture MARKDOWN' }).click();
  await expect(trail.locator('blockquote')).toContainText('A quorum can intersect across two majorities.');
  await expect(trail.getByRole('button', { name: 'Open in reader' })).toBeVisible();

  await page.getByRole('button', { name: 'Start fixture assessment' }).click();
  await expect(page.getByText('The passage describes overlap.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review supporting passage' })).toHaveCount(0);
  await page.getByText('No', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'No', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm & Submit' }).click();
  await page.getByRole('button', { name: 'Review supporting passage' }).click();
  await expect(trigger).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
  await expect.poll(() => highlightedSourceText(page)).toContain(first);
  await expect(page.getByText('Fixture HTML', { exact: true }).filter({ visible: true })).not.toHaveCount(0);
  await choose('Return to results');
  await expect(page.getByRole('heading', { name: 'Can two quorums overlap?' })).toBeVisible();
});

test('mobile EPUB highlights the book and exposes passage actions in its toolbar', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_OS_PLUGIN_INTERNALS__', { value: { platform: 'android' } });
  });
  await page.goto('/src/visual/entries/study-reading-flow-harness.html');
  await page.getByRole('button', { name: 'Start Guided Reading', exact: true }).click();
  for (const format of ['MARKDOWN', 'HTML']) {
    await expect(page.getByText(`Fixture ${format}`, { exact: true }).filter({ visible: true })).not.toHaveCount(0);
    await expect(readingTrigger(page)).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
    await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Mark passage complete' }).click();
    await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Next passage' }).click();
  }

  const toolbarToggle = page.getByRole('button', { name: 'Hide toolbar' });
  await expect(toolbarToggle).toBeVisible();
  await expect(readingTrigger(page)).toHaveCount(1);
  await expect(readingTrigger(page)).toBeInViewport();
  await expect(readingTrigger(page)).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
  await expect.poll(() => highlightedSourceText(page)).toContain(first);
  const epubFrames = page.getByRole('region', { name: 'Document content' }).locator('iframe');
  const assignedText = epubFrames.first().contentFrame().getByText(first, { exact: true });
  await expect(assignedText).toBeInViewport();
  const toolbarBounds = await toolbarToggle.boundingBox();
  const assignedBounds = await assignedText.boundingBox();
  expect(assignedBounds!.y).toBeGreaterThan(toolbarBounds!.y + toolbarBounds!.height);
  await expect(page.getByRole('menu', { name: 'Guided Reading' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('mobile-epub-reading.png') });

  const menu = await openReadingMenu(page);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(readingTrigger(page)).toBeFocused();
  await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Return to Study Plan' }).click();
  await expect(page.getByRole('button', { name: 'Continue Reading', exact: true })).toBeVisible();
});

test('the reader toolbar provides recovery if the next assigned document is missing', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/src/visual/entries/study-reading-flow-harness.html?missing=html');
  await page.getByRole('button', { name: 'Start Guided Reading', exact: true }).click();
  await expect(readingTrigger(page)).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
  await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Mark passage complete' }).click();
  await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Next passage' }).click();

  await expect(readingTrigger(page)).toHaveAccessibleDescription('The source is missing or archived.');
  await expect.poll(() => highlightedSourceText(page)).toEqual([]);
  const menu = await openReadingMenu(page);
  await expect(menu.getByRole('menuitem', { name: 'Mark passage complete' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: 'Retry passage' })).toBeEnabled();
  await menu.getByRole('menuitem', { name: 'Skip passage' }).click();
  await (await openReadingMenu(page)).getByRole('menuitem', { name: 'Next passage' }).click();
  await expect(page.getByText('Fixture EPUB', { exact: true }).filter({ visible: true })).not.toHaveCount(0);
  await expect(readingTrigger(page)).toHaveAccessibleDescription(exactDescription, { timeout: 25000 });
});
