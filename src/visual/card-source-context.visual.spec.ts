/**
 * Real-browser containment and interaction checks for the review-card source
 * strip (`CardSourceContext`).
 *
 * The reported defect: on a phone the source document title escaped the
 * review card because the flexible title segment had no shrink boundary and
 * the external link lived inside the title button. The harness renders the
 * real component with deterministic source data in the same padded card shell
 * used by `ReviewCard` (see `cardSourceContextHarness.tsx`).
 *
 * Run: npx playwright test src/visual/card-source-context.visual.spec.ts
 */
import { expect, test, type Page } from "@playwright/test";

const RESULTS_DIR = ".playwright/results";

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

interface FixtureGeometry {
  key: string;
  card: Rect;
  strip: Rect;
  title: Rect;
  titleClientHeight: number;
  titleScrollHeight: number;
  titleText: string;
  pageMarker: Rect | null;
  navigate: Rect;
  details: Rect;
  detailsExpanded: string | null;
  panel: { rect: Rect; hidden: boolean } | null;
  link: Rect | null;
  controls: Rect[];
}

interface PageGeometry {
  viewportWidth: number;
  documentScrollWidth: number;
  fixtures: FixtureGeometry[];
}

const PHONE_VIEWPORTS = [
  { name: "320x844", width: 320, height: 844 },
  { name: "360x844", width: 360, height: 844 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
];

const OTHER_VIEWPORTS = [
  { name: "landscape-844x390", width: 844, height: 390 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "narrow-desktop-600x900", width: 600, height: 900 },
];

const ALL_FIXTURES = [
  "short",
  "screenshot",
  "unbroken",
  "page-url",
  "no-snippet",
  "unavailable",
];

async function openHarness(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.context().route("https://example.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Fixture source</title><p>Source document</p>",
    }),
  );
  // The dev server can restart between tests under memory pressure; a bounded
  // retry keeps a cold Vite start from masquerading as a layout regression.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto("/card-source-context-harness.html", { timeout: 20_000 });
      await page
        .locator('[data-fixture="short"] [data-card-source-context]')
        .waitFor({ timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(1_500);
    }
  }
}

async function readGeometry(page: Page): Promise<PageGeometry> {
  return page.evaluate(() => {
    const rectOf = (element: Element): Rect => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };

    return {
      viewportWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      fixtures: Array.from(document.querySelectorAll("[data-fixture]")).map((fixture) => {
        const strip = fixture.querySelector("[data-card-source-context]")!;
        const title = strip.querySelector("[data-source-title-text]") as HTMLElement;
        const pageMarker = strip.querySelector("[data-source-page]");
        const panel = strip.querySelector("[data-source-details-panel]") as HTMLElement;
        const link = strip.querySelector("[data-source-link]");
        const details = strip.querySelector("[data-source-details]") as HTMLElement;

        return {
          key: fixture.getAttribute("data-fixture")!,
          card: rectOf(fixture.querySelector("[data-review-card-body]")!),
          strip: rectOf(strip),
          title: rectOf(title),
          titleClientHeight: title.clientHeight,
          titleScrollHeight: title.scrollHeight,
          titleText: title.textContent?.trim() ?? "",
          pageMarker: pageMarker ? rectOf(pageMarker) : null,
          navigate: rectOf(strip.querySelector("[data-source-navigate]")!),
          details: rectOf(details),
          detailsExpanded: details.getAttribute("aria-expanded"),
          panel: { rect: rectOf(panel), hidden: panel.hidden },
          link: link ? rectOf(link) : null,
          // Hidden panel content has a zero box; only visible targets are
          // measured. Collapsed strips expose the title and disclosure only.
          controls: Array.from(strip.querySelectorAll("button, a"))
            .map(rectOf)
            .filter((rect) => rect.width > 0 && rect.height > 0),
        };
      }),
    };
  });
}

function expectContained(inner: Rect, outer: Rect, label: string) {
  expect(inner.left, `${label}: left edge`).toBeGreaterThanOrEqual(outer.left - 0.75);
  expect(inner.right, `${label}: right edge`).toBeLessThanOrEqual(outer.right + 0.75);
  expect(inner.width, `${label}: positive width`).toBeGreaterThan(0);
}

function expectFixtureContained(geometry: PageGeometry, fixture: FixtureGeometry) {
  expectContained(fixture.strip, fixture.card, `${fixture.key} strip inside card`);
  expectContained(fixture.navigate, fixture.strip, `${fixture.key} title control inside strip`);
  expectContained(fixture.details, fixture.strip, `${fixture.key} details control inside strip`);
  expectContained(fixture.title, fixture.strip, `${fixture.key} title text inside strip`);
  for (const [index, control] of fixture.controls.entries()) {
    expectContained(control, fixture.strip, `${fixture.key} control ${index} inside strip`);
  }
  if (fixture.pageMarker) {
    expectContained(fixture.pageMarker, fixture.strip, `${fixture.key} page marker inside strip`);
  }
  expect(fixture.card.right).toBeLessThanOrEqual(geometry.viewportWidth + 0.75);
  expect(geometry.documentScrollWidth, "document must not gain horizontal scroll").toBeLessThanOrEqual(
    geometry.viewportWidth,
  );
}

async function expandAllDetails(page: Page) {
  for (const key of ALL_FIXTURES) {
    const toggle = page.locator(`[data-fixture="${key}"] [data-source-details]`);
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
  }
}

for (const viewport of [...PHONE_VIEWPORTS, ...OTHER_VIEWPORTS]) {
  test(`${viewport.name}: every source fixture stays inside the card collapsed and expanded`, async ({
    page,
  }) => {
    await openHarness(page, viewport.width, viewport.height);

    const collapsed = await readGeometry(page);
    expect(collapsed.documentScrollWidth).toBeLessThanOrEqual(collapsed.viewportWidth);
    expect(collapsed.fixtures.map((fixture) => fixture.key)).toEqual(ALL_FIXTURES);
    for (const fixture of collapsed.fixtures) {
      expectFixtureContained(collapsed, fixture);
      expect(fixture.detailsExpanded).toBe("false");
      expect(fixture.panel!.hidden).toBe(true);
    }

    await expandAllDetails(page);
    const expanded = await readGeometry(page);
    expect(expanded.documentScrollWidth).toBeLessThanOrEqual(expanded.viewportWidth);
    for (const fixture of expanded.fixtures) {
      expectFixtureContained(expanded, fixture);
      expect(fixture.panel!.hidden).toBe(false);
      expectContained(fixture.panel!.rect, fixture.strip, `${fixture.key} panel inside strip`);
      if (fixture.link) {
        expectContained(fixture.link, fixture.panel!.rect, `${fixture.key} link inside panel`);
      }
    }
  });
}

test("390px: reported title is clamped to two painted lines and fully readable in details", async ({
  page,
}) => {
  await openHarness(page, 390, 844);
  const fixture = page.locator('[data-fixture="screenshot"]');
  const title = fixture.locator("[data-source-title-text]");

  const painted = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      webkitLineClamp: style.webkitLineClamp,
      clientHeight: element.clientHeight,
    };
  });
  // Compact presentation is capped at two painted lines whether or not this
  // particular title happens to fill them exactly. A line-clamped box stops at
  // 32px (two 16px lines) no matter how long the stored title is.
  expect(painted.webkitLineClamp).toBe("2");
  expect(painted.clientHeight).toBeLessThanOrEqual(32);

  await fixture.locator("[data-source-details]").click();
  await expect(fixture.locator("[data-source-details]")).toHaveAttribute("aria-expanded", "true");
  const panel = fixture.locator("[data-source-details-panel]");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(
    "This Is Your Brain on Music: Understanding a Human Obsession",
  );
  await expect(panel).toContainText(
    "Music listening engages nearly every region of the brain",
  );

  await fixture.screenshot({ path: `${RESULTS_DIR}/card-source-context-390-expanded.png` });

  // The disclosure must not navigate the review card.
  const activations = await page.evaluate(() => window.cardSourceHarness?.activations ?? []);
  expect(activations).toEqual([]);
});

test("390px: tapping the title navigates once and disclosure remains independent", async ({
  page,
}) => {
  await openHarness(page, 390, 844);
  const fixture = page.locator('[data-fixture="short"]');

  await fixture.locator("[data-source-navigate]").click();
  await fixture.locator("[data-source-details]").click();
  await fixture.locator("[data-source-details]").click();

  const activations = await page.evaluate(() => window.cardSourceHarness?.activations ?? []);
  expect(activations).toEqual(["source-short"]);
});

test("390px: external link opens independently of navigation and disclosure", async ({ page }) => {
  await openHarness(page, 390, 844);
  const fixture = page.locator('[data-fixture="screenshot"]');
  await fixture.locator("[data-source-details]").click();

  const popupPromise = page.waitForEvent("popup");
  await fixture.locator("[data-source-link]").click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toBe("https://example.com/books/this-is-your-brain-on-music");
  await popup.close();

  const activations = await page.evaluate(() => window.cardSourceHarness?.activations ?? []);
  expect(activations).toEqual([]);
  await expect(fixture.locator("[data-source-details]")).toHaveAttribute("aria-expanded", "true");
});

test("390px: unavailable source keeps full-title access and shows bounded feedback", async ({
  page,
}) => {
  await openHarness(page, 390, 844);
  const fixture = page.locator('[data-fixture="unavailable"]');

  await fixture.locator("[data-source-navigate]").click();
  const status = fixture.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Source unavailable");
  await expect(status).toContainText("The excerpt survives");

  const geometry = await readGeometry(page);
  const measured = geometry.fixtures.find((item) => item.key === "unavailable")!;
  expectContained(measured.strip, measured.card, "unavailable strip inside card");
  expectContained(measured.strip, measured.card, "unavailable feedback inside card");
  await expect(fixture.locator("[data-source-title-text]")).toContainText(
    "Removed Source Document",
  );

  await fixture.locator("[data-source-details]").click();
  await expect(fixture.locator("[data-source-details-panel]")).toBeVisible();
  await expect(fixture.locator("[data-source-details-panel]")).toContainText(
    "Removed Source Document",
  );

  const activations = await page.evaluate(() => window.cardSourceHarness?.activations ?? []);
  expect(activations).toEqual([]);
});

test("390px: hit testing reaches every control and the title focuses before details", async ({
  page,
}) => {
  await openHarness(page, 390, 844);
  const fixture = page.locator('[data-fixture="screenshot"]');
  await fixture.scrollIntoViewIfNeeded();
  await fixture.locator("[data-source-details]").click();

  const unreachable = await page.evaluate(() => {
    const misses: string[] = [];
    for (const element of document.querySelectorAll(
      '[data-fixture="screenshot"] [data-card-source-context] button, [data-fixture="screenshot"] [data-card-source-context] a',
    )) {
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      if (!hit || !(element === hit || element.contains(hit))) {
        misses.push(`${element.tagName.toLowerCase()}:${element.textContent?.trim().slice(0, 30)}`);
      }
    }
    return misses;
  });
  expect(unreachable).toEqual([]);

  await fixture.locator("[data-source-navigate]").focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.hasAttribute("data-source-details")),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.hasAttribute("data-source-link")),
  ).toBe(true);
  await fixture.screenshot({ path: `${RESULTS_DIR}/card-source-context-390-focus.png` });
});

for (const width of [320, 390]) {
  test(`${width}px at 200% text: source strip grows vertically without overflowing`, async ({
    page,
  }) => {
    await openHarness(page, width, 844);
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await page.waitForTimeout(100);

    const collapsed = await readGeometry(page);
    expect(collapsed.documentScrollWidth).toBeLessThanOrEqual(collapsed.viewportWidth);
    for (const fixture of collapsed.fixtures) {
      expectFixtureContained(collapsed, fixture);
    }

    await expandAllDetails(page);
    const expanded = await readGeometry(page);
    expect(expanded.documentScrollWidth).toBeLessThanOrEqual(expanded.viewportWidth);
    for (const fixture of expanded.fixtures) {
      expectFixtureContained(expanded, fixture);
      expectContained(fixture.panel!.rect, fixture.strip, `${fixture.key} panel inside strip`);
    }

    if (width === 320) {
      await page
        .locator('[data-fixture="screenshot"]')
        .screenshot({ path: `${RESULTS_DIR}/card-source-context-320-text-200.png` });
    }
  });
}

test.describe("coarse pointer", () => {
  test.use({ hasTouch: true });

  test("390px: source controls meet the 48px touch minimum", async ({ page }) => {
    await openHarness(page, 390, 844);
    const matchesCoarse = await page.evaluate(
      () => window.matchMedia("(pointer: coarse)").matches,
    );
    expect(matchesCoarse).toBe(true);

    const fixture = page.locator('[data-fixture="screenshot"]');
    await fixture.locator("[data-source-details]").click();

    const targets = await page.evaluate(() => {
      const strip = document.querySelector(
        '[data-fixture="screenshot"] [data-card-source-context]',
      )!;
      return Array.from(strip.querySelectorAll("button, a")).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute("data-source-navigate") !== null
              ? "title"
              : element.getAttribute("data-source-details") !== null
                ? "details"
                : "link",
          width: rect.width,
          height: rect.height,
        };
      });
    });

    expect(targets.length).toBe(3);
    for (const target of targets) {
      expect(target.height, `${target.label} height`).toBeGreaterThanOrEqual(48);
      expect(target.width, `${target.label} width`).toBeGreaterThanOrEqual(48);
    }
  });
});

test("desktop: title and details controls meet the 40px minimum", async ({ page }) => {
  await openHarness(page, 1440, 900);
  const fixture = page.locator('[data-fixture="screenshot"]');
  await fixture.locator("[data-source-details]").click();

  const targets = await page.evaluate(() => {
    const strip = document.querySelector(
      '[data-fixture="screenshot"] [data-card-source-context]',
    )!;
    return Array.from(strip.querySelectorAll("button, a")).map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  });
  for (const target of targets) {
    expect(target.height).toBeGreaterThanOrEqual(40);
    expect(target.width).toBeGreaterThanOrEqual(40);
  }
  await page.locator('[data-fixture="screenshot"]').screenshot({
    path: `${RESULTS_DIR}/card-source-context-desktop-expanded.png`,
  });
});

test("short title stays on one line and the unbroken title is capped at two", async ({ page }) => {
  await openHarness(page, 390, 844);
  const measure = (fixture: string) =>
    page.locator(`[data-fixture="${fixture}"] [data-source-title-text]`).evaluate((element) => ({
      webkitLineClamp: getComputedStyle(element).webkitLineClamp,
      clientHeight: element.clientHeight,
      text: element.textContent?.trim(),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));

  const short = await measure("short");
  expect(short.text).toBe("Memory Systems");
  expect(short.clientHeight).toBeLessThanOrEqual(17); // one 16px line
  expect(short.scrollWidth).toBeLessThanOrEqual(short.clientWidth + 1);

  const unbroken = await measure("unbroken");
  expect(unbroken.webkitLineClamp).toBe("2");
  expect(unbroken.clientHeight).toBeLessThanOrEqual(32);
  expect(unbroken.clientWidth).toBeGreaterThan(0);
});

test("page marker and external URL never squeeze the title", async ({ page }) => {
  await openHarness(page, 360, 844);
  const fixture = page.locator('[data-fixture="page-url"]');
  await fixture.scrollIntoViewIfNeeded();

  const marker = fixture.locator("[data-source-page]");
  await expect(marker).toBeVisible();
  await expect(marker).toContainText("Page 42");

  await fixture.locator("[data-source-details]").click();
  await expect(fixture.locator("[data-source-link]")).toBeVisible();
  await expect(fixture.locator("[data-source-link]")).toHaveAttribute(
    "href",
    "https://example.com/field-guide/deep-sea",
  );

  const geometry = await readGeometry(page);
  const measured = geometry.fixtures.find((item) => item.key === "page-url")!;
  expectFixtureContained(geometry, measured);
  expect(measured.pageMarker!.right).toBeLessThanOrEqual(measured.strip.right + 0.75);
  expect(measured.title.width).toBeGreaterThan(80);
});
