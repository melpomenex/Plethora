import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const output = '.playwright/results/assistant-context-actions';
mkdirSync(output, { recursive: true });
const layouts = [
  { name: 'phone-320-partial', width: 320, height: 740, query: 'mobile&partial' },
  { name: 'phone-390-expanded', width: 390, height: 844, query: 'mobile' },
  { name: 'phone-430-partial', width: 430, height: 932, query: 'mobile&partial' },
  { name: 'phone-short', width: 390, height: 580, query: 'mobile' },
  { name: 'phone-landscape', width: 740, height: 390, query: 'mobile' },
  { name: 'phone-keyboard', width: 390, height: 844, query: 'mobile&keyboard' },
  { name: 'phone-german-200', width: 390, height: 844, query: 'mobile&locale=de&zoom' },
  { name: 'desktop-320', width: 1280, height: 800, query: 'width=320' },
  { name: 'desktop-430-dark', width: 1280, height: 800, query: 'width=430&theme=obsidian-noir' },
  { name: 'desktop-600', width: 1400, height: 900, query: 'width=600' },
  { name: 'desktop-german-200', width: 1400, height: 900, query: 'width=400&locale=de&zoom' },
];
for (const layout of layouts) test(`${layout.name}: action fit, menu bounds and draft continuity`, async ({ page }) => {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const inference: string[] = [];
  page.on('request', request => { if (/api\.openai|openrouter\.ai|api\.anthropic/.test(request.url())) inference.push(request.url()); });
  await page.goto(`/assistant-controls-harness.html?actions&${layout.query}`);
  const strip = page.locator('[data-assistant-action-strip]');
  const add = page.locator('[data-assistant-composer-add]');
  const mobile = layout.query.includes('mobile');
  const more = strip.getByRole('button', { name: /^(More|Actions|Mehr|Aktionen)$/ });
  if (layout.query.includes('keyboard')) await expect(strip).toHaveCount(0);
  else {
    await expect(strip).toBeVisible({ timeout: 30000 });
    expect(await strip.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const controls = strip.locator(':scope > div:last-child > button');
    for (const control of await controls.all()) {
      const box = await control.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(40);
      expect(await control.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
  }
  await page.screenshot({ path: `${output}/${layout.name}-idle.png` });
  if (layout.query.includes('keyboard')) await add.click(); else await more.click();
  const menu = page.locator(mobile ? '[data-assistant-composer-menu]' : '[role=dialog]').filter({ has: page.locator('[data-assistant-actions-menu]') });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox(); const sheet = await page.locator('[data-harness-sheet]').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(sheet!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(sheet!.x + sheet!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(sheet!.y - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(sheet!.y + sheet!.height + 1);
  expect(await menu.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(menu.locator('[data-assistant-actions-menu] button').filter({ hasText: /Zusammenfassen|Summarize/ })).toHaveCount(1);
  const lastAction = menu.getByRole('button', { name: /^(Make flashcards|Lernkarten erstellen) ·/ });
  await lastAction.scrollIntoViewIfNeeded();
  await expect(lastAction).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${output}/${layout.name}-menu.png` });
  await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  if (!mobile) await expect(more).toBeFocused(); else await expect(add).toBeFocused();
  const input = page.getByRole('textbox'); await input.fill('Keep my unsent draft');
  if (mobile) { await expect(strip).toHaveCount(0); await add.click(); }
  else await more.click();
  await expect(page.locator('[data-assistant-actions-menu]')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(input).toHaveValue('Keep my unsent draft');
  expect(inference).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
