import { test, expect } from '@playwright/test';

const GUIDED_ACTIONS = [
  ['Open / Read', 'reader.open'],
  ['Select passage', 'reader.selected'],
  ['Learn this', 'remember.preview'],
  ['Add card', 'review.question'],
  ['Show Answer', 'review.answer'],
  ['Good', 'review.scheduled'],
  ['View connections', 'connections.context'],
] as const;

test('complete guided path uses only real mapped actions', async ({ page }) => {
  await page.goto('/demo');
  const simulator = page.locator('[data-showcase-simulator]');
  await expect(simulator).toHaveAttribute('data-stage', 'library.ready');

  const startStage = await simulator.getAttribute('data-stage');
  await page.locator('.showcase-product-stage').click({ position: { x: 12, y: 12 } });
  await expect(simulator).toHaveAttribute('data-stage', startStage!);

  for (const [action, nextScene] of GUIDED_ACTIONS) {
    const hotspot = page.getByRole('button', { name: action, exact: true });
    await expect(hotspot).toBeVisible();
    await hotspot.click();
    await expect(simulator).toHaveAttribute('data-stage', nextScene);
  }

  await expect(page.getByText('The guided flow is complete.', { exact: false })).toBeAttached();
});

test('keyboard behavior is scoped, cycles hotspots, and restores focus on exit', async ({ page }) => {
  await page.goto('/demo');
  const simulator = page.locator('[data-showcase-simulator]');
  await page.locator('#main').focus();
  await page.keyboard.press('ArrowRight');
  await expect(simulator).toHaveAttribute('data-stage', 'library.ready');

  const open = page.getByRole('button', { name: 'Open / Read', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(simulator).toHaveAttribute('data-stage', 'reader.open');
  await page.getByRole('button', { name: 'Select passage', exact: true }).press('Enter');
  await expect(simulator).toHaveAttribute('data-stage', 'reader.selected');

  await page.getByRole('button', { name: 'Explore', exact: true }).click();
  const explain = page.getByRole('button', { name: 'Explain', exact: true });
  const learn = page.getByRole('button', { name: 'Learn this', exact: true });
  await explain.press('ArrowRight');
  await expect(learn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(simulator).toHaveAttribute('data-stage', 'remember.preview');

  await expect(page.getByRole('button', { name: 'Add card', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(simulator).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume flow', exact: true })).toBeFocused();
});

test('deep links clamp invalid state and update canonical scene URLs', async ({ page }) => {
  await page.goto('/demo?scene=review.answer&layout=mobile');
  await expect(page.locator('[data-showcase-simulator]')).toHaveAttribute('data-stage', 'review.answer');
  await expect(page.locator('[data-showcase-simulator]')).toHaveClass(/showcase-simulator--mobile/);

  await page.goto('/demo?scene=..%2F..%2Fprivate&layout=watch&asset=%2Fetc%2Fpasswd');
  await expect(page.locator('[data-showcase-simulator]')).toHaveAttribute('data-stage', 'library.ready');
  await expect.poll(() => page.url()).toMatch(/\/demo\?scene=library\.ready&layout=desktop$/);
});

test('mobile controls remain touch-sized and desktop detail stays inspectable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo?scene=review.answer&layout=mobile');
  const good = page.getByRole('button', { name: 'Good', exact: true });
  await expect(good).toBeVisible();
  const box = await good.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  const pan = page.locator('.showcase-product-stage__pan');
  const dimensions = await pan.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
});

test('image failure keeps the story and a retry control', async ({ page }) => {
  await page.route('**/library.ready--desktop--*', (route) => {
    if (route.request().url().includes('retry=1')) return route.continue();
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/demo');
  await expect(page.getByText('The product scene could not be loaded.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[data-image-state="ready"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open / Read', exact: true })).toBeVisible();
  await expect(page.getByText('Try: Open / Read', { exact: true })).toBeVisible();
});

test('touch activates a real mobile hotspot', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: String(testInfo.project.use.baseURL),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto('/demo?scene=library.ready&layout=mobile');
  const simulator = page.locator('[data-showcase-simulator]');
  const open = page.getByRole('button', { name: 'Open / Read', exact: true });
  await expect(open).toBeVisible();
  await open.tap();
  await expect(simulator).toHaveAttribute('data-stage', 'reader.open');
  await context.close();
});

test('JavaScript-free homepage keeps the complete ordered story', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const desk = page.locator('[data-home-demo-slot]');
  await expect(desk.getByRole('heading', { name: 'From first read to useful recall.' })).toBeVisible();
  await expect(desk.locator('[data-chapter]')).toHaveCount(5);
  await expect(desk.getByRole('img').first()).toBeVisible();
  await expect(desk.getByRole('link', { name: 'Try the flow', exact: true })).toHaveAttribute(
    'href',
    /\/demo\?scene=review\.question/,
  );
  await context.close();
});
