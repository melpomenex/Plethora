import { expect, test, type Page } from "@playwright/test";
import { RSS_DEFAULTS, type RssUserPreferenceUpdate } from "../types/rssCustomization";

const FEED_COUNT = 20;
const ARTICLES_PER_FEED = 50;
const IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='steelblue'/%3E%3C/svg%3E";

type HarnessAction = {
  type: string;
  itemId?: string;
  feedId?: string;
  key?: string;
};

interface RouteFixtures {
  preferences: RssUserPreferenceUpdate;
}

function articleTitle(index: number): string {
  if (index === 10) {
    return "A deliberately long headline that should wrap naturally across multiple lines without ever being squeezed into a narrow column by the action controls or a thumbnail";
  }
  if (index === 11) return `Unbroken token ${"z".repeat(220)} end`;
  return `Article ${String(index).padStart(4, "0")}`;
}

function backendFeeds() {
  return Array.from({ length: FEED_COUNT }, (_, feedIndex) => ({
    id: `feed-${feedIndex}`,
    url: `https://feed-${feedIndex}.example/rss`,
    title: `Feed ${feedIndex}`,
    description: `Deterministic fixture feed ${feedIndex}`,
    update_interval: 3600,
    is_active: true,
    date_added: "2026-01-01",
    unread_count: ARTICLES_PER_FEED,
  }));
}

function backendArticles(feedId: string) {
  const feedIndex = Number(feedId.replace("feed-", ""));
  return Array.from({ length: ARTICLES_PER_FEED }, (_, articleIndex) => {
    const globalIndex = feedIndex * ARTICLES_PER_FEED + articleIndex;
    const shared = feedIndex < 2 && articleIndex === 3;
    const duplicate = shared ? "shared-article" : undefined;
    const dateIndex = shared ? 3 : globalIndex;
    const published = new Date(Date.UTC(2026, 0, 1, 12, 0, 0) - dateIndex * 60_000);
    return {
      id: duplicate ?? `feed-${feedIndex}-article-${articleIndex}`,
      feed_id: feedId,
      title: articleTitle(globalIndex),
      author: globalIndex === 1 ? "" : globalIndex === 12 ? "Different Author" : "Jane Researcher",
      url: `https://example.com/article/${globalIndex}`,
      published_date: published.toISOString(),
      date_added: published.toISOString(),
      is_read: false,
      is_queued: false,
      summary:
        globalIndex === 13
          ? ""
          : "A deterministic excerpt with enough words to fill several lines in the expanded List card preview.",
      content:
        globalIndex === 13
          ? ""
          : "<p>A deterministic excerpt with enough words to fill several lines in the expanded List card preview.</p>",
      thumbnail: globalIndex % 3 === 0 ? IMAGE : undefined,
      intelligence_score: globalIndex % 9 === 0 ? 1.5 : 0,
    };
  });
}

async function installRoutes(page: Page, fixtures: RouteFixtures) {
  await page.route("**/s2/favicons/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: IMAGE }),
  );
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    if (path === "/api/rss/preferences") {
      if (request.method() === "PUT") {
        Object.assign(fixtures.preferences, request.postDataJSON());
      }
      await route.fulfill({
        json: {
          ...fixtures.preferences,
          id: "default",
          date_created: "2026-01-01",
          date_modified: "2026-01-01",
        },
      });
      return;
    }
    if (path === "/api/rss/feeds") {
      await route.fulfill({ json: backendFeeds() });
      return;
    }
    const articlesMatch = path.match(/^\/api\/rss\/feeds\/([^/]+)\/articles$/);
    if (articlesMatch) {
      const limit = Number(url.searchParams.get("limit") ?? ARTICLES_PER_FEED);
      await route.fulfill({ json: backendArticles(articlesMatch[1]).slice(0, limit) });
      return;
    }
    if (path.startsWith("/api/rss/articles/")) {
      if (path.endsWith("/tags") && request.method() === "GET") {
        await route.fulfill({ json: [] });
      } else {
        await route.fulfill({ json: { success: true } });
      }
      return;
    }
    await route.fulfill({ json: [] });
  });
}

async function openHarness(page: Page, fixtures: RouteFixtures) {
  await installRoutes(page, fixtures);
  await page.goto("/rss-customization-harness.html");
  await page.getByRole("button", { name: "list-card", exact: true }).waitFor();
}

async function openCard(
  page: Page,
  options: {
    width?: number;
    preferences?: RssUserPreferenceUpdate;
    item?: Record<string, unknown>;
  } = {},
) {
  const baseline = {
    id: "article-a",
    feedId: "feed-a",
    title: "A measured article headline",
    author: "Jane",
    pubDate: "2026-10-01T10:00:00Z",
    read: true,
    favorite: false,
    categories: ["science"],
    description: "<p>Article paragraph for reading appearance verification.</p>",
    content: "",
    fullContent: "",
    link: "https://example.com/article",
    thumbnail: IMAGE,
  };
  await page.evaluate(
    ({ width, preferences, item }) => {
      window.rssHarness.setView("list-card");
      if (width) window.rssHarness.setListWidth(width);
      if (preferences) window.rssHarness.setPreferences(preferences);
      window.rssHarness.setCardFixture(item);
    },
    {
      width: options.width,
      preferences: options.preferences,
      item: { ...baseline, ...options.item },
    },
  );
  const viewport = page.locator("#list-card-viewport");
  await viewport.waitFor();
  const card = viewport.locator("[data-rss-list-card]");
  await card.waitFor();
  return { viewport, card };
}

async function actions(page: Page): Promise<HarnessAction[]> {
  return (await page.evaluate(() => window.rssHarness.getActions())) as HarnessAction[];
}

async function resetActions(page: Page) {
  await page.evaluate(() => window.rssHarness.resetActions());
}

test.describe("List card responsive header", () => {
  let fixtures: RouteFixtures;
  test.beforeEach(async ({ page }) => {
    fixtures = { preferences: { ...RSS_DEFAULTS } };
    await openHarness(page, fixtures);
  });

  for (const width of [320, 360, 420, 719, 720, 800]) {
    test(`keeps title and all actions inside ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await openCard(page, {
        width,
        preferences: { ...RSS_DEFAULTS, view_mode: "card", density: "normal" },
        item: { title: articleTitle(10), read: true, fullContent: "" },
      });

      const viewport = page.locator("#list-card-viewport");
      const box = (await viewport.boundingBox())!;
      expect(box.width).toBeCloseTo(width, 0);

      const overflow = await viewport.evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        cardScrollWidth: el.querySelector("[data-rss-list-card]")!.scrollWidth,
        cardClientWidth: el.querySelector("[data-rss-list-card]")!.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      expect(overflow.cardScrollWidth).toBeLessThanOrEqual(overflow.cardClientWidth + 1);

      const controls = page.locator(".rss-list-actions > :is(button, a[href])");
      await expect(controls).toHaveCount(7);
      for (let i = 0; i < 7; i += 1) {
        await expect(controls.nth(i)).toBeVisible();
        const controlBox = (await controls.nth(i).boundingBox())!;
        expect(controlBox.width).toBeCloseTo(40, 0);
        expect(controlBox.height).toBeCloseTo(40, 0);
      }

      const titleBox = (await page.locator(".rss-list-title").boundingBox())!;
      const actionBox = (await page.locator(".rss-list-actions").boundingBox())!;
      if (width < 720) {
        expect(actionBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
        expect(titleBox.width).toBeGreaterThanOrEqual(width === 420 ? 340 : 240);
      } else {
        expect(titleBox.y).toBeLessThan(actionBox.y + actionBox.height);
        expect(actionBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width - 1);
        expect(titleBox.width).toBeGreaterThanOrEqual(240);
      }
    });
  }

  test("changes topology exactly between 719px and 720px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, {
      width: 719,
      preferences: { ...RSS_DEFAULTS, density: "comfortable", view_mode: "list" },
      item: { title: articleTitle(10), read: true, fullContent: "" },
    });
    const stackedTitle = (await page.locator(".rss-list-title").boundingBox())!;
    const stackedActions = (await page.locator(".rss-list-actions").boundingBox())!;
    expect(stackedActions.y).toBeGreaterThanOrEqual(stackedTitle.y + stackedTitle.height - 1);

    await page.evaluate(() => window.rssHarness.setListWidth(720));
    await expect.poll(async () => {
      const title = (await page.locator(".rss-list-title").boundingBox())!;
      const actions = (await page.locator(".rss-list-actions").boundingBox())!;
      return actions.y < title.y + title.height - 1;
    }).toBe(true);
  });
});

test.describe("List card disclosure", () => {
  let fixtures: RouteFixtures;
  test.beforeEach(async ({ page }) => {
    fixtures = { preferences: { ...RSS_DEFAULTS } };
    await openHarness(page, fixtures);
  });

  test("reveals details after deliberate hover, not on entry or rapid crossings", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, { width: 420, item: { title: articleTitle(10), read: true, fullContent: "" } });
    const card = page.locator("[data-rss-list-card]");
    const details = card.locator(".rss-list-details");
    await expect(details).toBeHidden();

    const box = (await card.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.waitForTimeout(60);
    await expect(details).toBeHidden();
    await page.waitForTimeout(90);
    await expect(details).toBeVisible();
    await expect(card).toHaveAttribute("data-expanded", "true");

    await page.mouse.move(box.x - 20, box.y + box.height / 2);
    await expect(details).toBeHidden();

    // Rapid crossing never opens a preview.
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.move(box.x - 20, box.y + box.height / 2);
    await page.waitForTimeout(160);
    await expect(details).toBeHidden();
  });

  test("expands with keyboard focus and collapses after tabbing out", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, { width: 420, item: { title: articleTitle(10), read: true, fullContent: "" } });
    const card = page.locator("[data-rss-list-card]");
    const details = card.locator(".rss-list-details");

    // Focus the last harness header button, then Tab into the card title.
    await page.getByRole("button", { name: "list-stress", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(".rss-list-title")).toBeFocused();
    await expect(details).toBeVisible();

    for (let i = 0; i < 7; i += 1) await page.keyboard.press("Tab");
    await expect(page.locator(".rss-list-details-toggle")).toBeFocused();
    await expect(details).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(details).toBeHidden();
  });

  test("Escape collapses without moving focus and the toggle reopens", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, { width: 420, item: { title: articleTitle(10), read: true, fullContent: "" } });
    const card = page.locator("[data-rss-list-card]");
    const details = card.locator(".rss-list-details");
    const toggle = page.locator(".rss-list-details-toggle");

    await toggle.click();
    await expect(details).toBeVisible();
    await expect(toggle).toBeFocused();
    await resetActions(page);

    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
    await expect(toggle).toBeFocused();
    await page.waitForTimeout(160);
    await expect(details).toBeHidden();

    await page.keyboard.press("Enter");
    await expect(details).toBeVisible();
    expect((await actions(page)).filter((action) => action.type === "select")).toHaveLength(0);
  });

  test("native commands and anchor activation never select through bubbling", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, { width: 420, item: { read: true, fullContent: "" } });
    await resetActions(page);
    const nativeCommands = [
      ["Fetch full content", "fetch"],
      ["Add to favorites", "favorite"],
      ["Open original", "external"],
      ["Mark as unread", "unread"],
      ["Train intelligence", "train"],
      ["Tag article", "tag"],
    ] as const;

    for (const [name, type] of nativeCommands) {
      const control = page.getByRole(type === "external" ? "link" : "button", { name, exact: true });
      await control.focus();
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await actions(page)).some((action) => action.type === type)).toBe(true);
    }
    expect((await actions(page)).filter((action) => action.type === "select")).toHaveLength(0);

    await page.locator(".rss-list-title").click();
    expect((await actions(page)).filter((action) => action.type === "select")).toHaveLength(1);

    await resetActions(page);
    for (const [name, type] of nativeCommands) {
      if (type === "external") continue; // Anchors activate on Enter, not Space.
      const control = page.getByRole("button", { name, exact: true });
      await control.focus();
      await page.keyboard.press(" ");
      await expect.poll(async () => (await actions(page)).some((action) => action.type === type)).toBe(true);
    }
    expect((await actions(page)).filter((action) => action.type === "select")).toHaveLength(0);
  });

  test("Shift+F10 and the Menu key reach the context-menu handler", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, { width: 420, item: { read: true, fullContent: "" } });
    await resetActions(page);
    await page.locator(".rss-list-title").focus();
    await page.keyboard.press("Shift+F10");
    await expect.poll(async () => (await actions(page)).some((action) => action.type === "menu-key")).toBe(true);
    expect((await actions(page)).filter((action) => action.type === "select")).toHaveLength(0);
  });
});

test.describe("List card preferences", () => {
  let fixtures: RouteFixtures;
  test.beforeEach(async ({ page }) => {
    fixtures = { preferences: { ...RSS_DEFAULTS } };
    await openHarness(page, fixtures);
  });

  test("maps density, card presentation and thumbnail geometry", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [density, paddingY, paddingX] of [
      ["compact", "8px", "12px"],
      ["normal", "12px", "16px"],
      ["comfortable", "16px", "20px"],
    ] as const) {
      await openCard(page, {
        width: 420,
        preferences: { ...RSS_DEFAULTS, density, show_thumbnails: true },
        item: { thumbnail: IMAGE, read: true, fullContent: "" },
      });
      const card = page.locator("[data-rss-list-card]");
      await expect(card).toHaveAttribute("data-density", density);
      await expect(card).toHaveCSS("padding-top", paddingY);
      await expect(card).toHaveCSS("padding-left", paddingX);
    }

    for (const [view_mode, size, width, height] of [
      ["card", "small", 96, 64],
      ["card", "large", null, 160],
      ["list", "small", 64, 48],
      ["list", "large", 96, 64],
    ] as const) {
      await openCard(page, {
        width: 420,
        preferences: { ...RSS_DEFAULTS, view_mode, thumbnail_size: size },
        item: { thumbnail: IMAGE, read: true, fullContent: "" },
      });
      const thumb = page.locator(".rss-list-thumb");
      await expect(thumb).toBeVisible();
      const box = (await thumb.boundingBox())!;
      if (width !== null) expect(box.width).toBeCloseTo(width, 0);
      expect(box.height).toBeCloseTo(height, 0);
      if (view_mode === "card" && size === "large") {
        const cardWidth = (await page.locator("[data-rss-list-card]").boundingBox())!.width;
        // Large card thumbnails fill the inner body width, not the card border box.
        expect(box.width).toBeGreaterThan(cardWidth - 40);
      }
    }

    await openCard(page, {
      width: 420,
      preferences: { ...RSS_DEFAULTS, view_mode: "compact", show_thumbnails: true },
      item: { thumbnail: IMAGE, read: true, fullContent: "" },
    });
    await expect(page.locator(".rss-list-thumb")).toHaveCount(0);
  });

  test("progressively discloses excerpt and author under the preference table", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const [height, expectedClass, expected] of [
      ["compact", null, false],
      ["normal", "rss-list-excerpt--3", true],
      ["tall", "rss-list-excerpt--4", true],
    ] as const) {
      await openCard(page, {
        width: 420,
        preferences: { ...RSS_DEFAULTS, card_height: height, show_author: true },
        item: { author: "Jane Researcher", read: true, fullContent: "" },
      });
      const card = page.locator("[data-rss-list-card]");
      await expect(card.locator(".rss-list-details")).toBeHidden();
      await expect(card.locator(".rss-list-author")).toBeHidden();
      await page.locator(".rss-list-details-toggle").click();
      await expect(card.locator(".rss-list-details")).toBeVisible();
      if (expected) {
        await expect(card.locator(".rss-list-excerpt")).toHaveClass(
          new RegExp(expectedClass!),
        );
        await expect(card.locator(".rss-list-author")).toBeVisible();
      } else {
        await expect(card.locator(".rss-list-excerpt")).toHaveCount(0);
        await expect(card.locator(".rss-list-author")).toBeVisible();
      }
    }

    for (const [excerpt_length, max] of [
      [50, 53],
      [150, 153],
      [500, 503],
    ] as const) {
      await openCard(page, {
        width: 420,
        preferences: { ...RSS_DEFAULTS, excerpt_length, card_height: "tall" },
        item: {
          description: `<p>${"word ".repeat(120)}</p>`,
          content: "",
          fullContent: "",
          read: true,
        },
      });
      await page.locator(".rss-list-details-toggle").click();
      await expect.poll(async () => (await page.locator(".rss-list-excerpt").textContent())!.length).toBeLessThanOrEqual(max);
    }

    await openCard(page, {
      width: 420,
      preferences: {
        ...RSS_DEFAULTS,
        show_author: false,
        show_date: false,
        show_feed_icon: false,
        view_mode: "compact",
        card_height: "tall",
      },
      item: { author: "Jane Researcher", read: true, fullContent: "" },
    });
    const compact = page.locator("[data-rss-list-card]");
    await expect(compact.locator(".rss-list-feed-icon")).toHaveCount(0);
    await expect(compact.locator("time")).toHaveCount(0);
    await page.locator(".rss-list-details-toggle").click();
    await expect(compact.locator(".rss-list-excerpt")).toHaveClass(/rss-list-excerpt--2/);
    await expect(compact.locator(".rss-list-author")).toHaveCount(0);
  });

  test("empty content and broken images create no empty regions", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openCard(page, {
      width: 420,
      preferences: { ...RSS_DEFAULTS, show_author: true },
      item: {
        description: "",
        content: "",
        fullContent: "",
        author: "",
        thumbnail: "data:image/png;base64,not-a-real-image",
        read: true,
      },
    });
    await expect(page.locator(".rss-list-thumb")).toHaveCount(0);
    await page.locator(".rss-list-details-toggle").click();
    await expect(page.locator(".rss-list-details")).not.toHaveAttribute("hidden");
    await expect(page.locator(".rss-list-excerpt")).toHaveCount(0);
    await expect(page.locator(".rss-list-author")).toHaveCount(0);
    const detailsHeight = await page
      .locator(".rss-list-details")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(detailsHeight).toBeLessThanOrEqual(1);
  });

  test("applies light, dark and legal-pad themes with token colours", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(async () =>
      (await page.evaluate(() => window.rssHarness.getThemes())).includes("aurora-light"),
    ).toBe(true);
    await openCard(page, { width: 420, item: { read: true, fullContent: "" } });
    const card = page.locator("[data-rss-list-card]");
    let previous = "";
    for (const theme of ["aurora-light", "modern-dark", "legal-pad"]) {
      await page.evaluate((id) => window.rssHarness.setTheme(id), theme);
      await expect.poll(async () =>
        card.evaluate((el) => getComputedStyle(el).backgroundColor),
      ).not.toBe(previous);
      const colour = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(colour).not.toBe("rgba(0, 0, 0, 0)");
      expect(colour).not.toContain("255, 255, 0");
      previous = colour;
    }
  });

  test("reduced motion and disabled animations make disclosure instant", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openCard(page, { width: 420, item: { read: true, fullContent: "" } });
    await page.locator(".rss-list-details-toggle").click();
    const duration = await page
      .locator(".rss-list-details")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(Number.parseFloat(duration)).toBe(0);
    const cardTransition = await page
      .locator("[data-rss-list-card]")
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(Number.parseFloat(cardTransition)).toBe(0);

    await page.evaluate(() => document.documentElement.setAttribute("data-animations", "off"));
    await page.locator(".rss-list-details-toggle").click();
    await page.locator(".rss-list-details-toggle").click();
    const offDuration = await page
      .locator(".rss-list-details")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    expect(Number.parseFloat(offDuration)).toBe(0);
  });

  test("captures representative 420px and 320px touch screenshots", async ({ browser }) => {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await desktop.newPage();
    const fixtures: RouteFixtures = { preferences: { ...RSS_DEFAULTS } };
    await openHarness(page, fixtures);
    await expect.poll(async () =>
      (await page.evaluate(() => window.rssHarness.getThemes())).includes("aurora-light"),
    ).toBe(true);
    await openCard(page, {
      width: 420,
      item: { title: articleTitle(10), read: true, fullContent: "" },
    });
    await page.screenshot({ path: ".playwright/results/rss-list-420-collapsed.png" });
    await page.locator(".rss-list-details-toggle").click();
    await page.screenshot({ path: ".playwright/results/rss-list-420-expanded.png" });
    for (const theme of ["aurora-light", "modern-dark", "legal-pad"]) {
      await page.evaluate((id) => window.rssHarness.setTheme(id), theme);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `.playwright/results/rss-list-420-${theme}.png` });
    }
    await desktop.close();

    const touch = await browser.newContext({
      viewport: { width: 320, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const touchPage = await touch.newPage();
    await openHarness(touchPage, { preferences: { ...RSS_DEFAULTS } });
    await openCard(touchPage, {
      width: 320,
      item: { title: articleTitle(10), read: true, fullContent: "" },
    });
    await touchPage.locator(".rss-list-details-toggle").tap();
    await touchPage.screenshot({ path: ".playwright/results/rss-list-320-touch-expanded.png" });
    await touch.close();
  });
});

async function openStress(
  page: Page,
  viewport: { width: number; height: number } = { width: 1200, height: 800 },
) {
  await page.setViewportSize(viewport);
  const fixtures: RouteFixtures = { preferences: { ...RSS_DEFAULTS } };
  await openHarness(page, fixtures);
  await page.getByRole("button", { name: "list-stress", exact: true }).click();
  const scroller = page.locator(".rss-list-viewport");
  await scroller.waitFor({ timeout: 30_000 });
  await page.locator("[data-rss-list-card]").first().waitFor({ timeout: 30_000 });
  return { fixtures, scroller };
}

async function virtualRows(page: Page) {
  return page.locator(".rss-list-viewport [data-index]").evaluateAll((elements) =>
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          index: Number(element.getAttribute("data-index")),
          top: rect.top,
          bottom: rect.bottom,
        };
      })
      .sort((a, b) => a.index - b.index),
  );
}

async function scrollToIndex(page: Page, target: number) {
  const scroller = page.locator(".rss-list-viewport");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const rows = await virtualRows(page);
    if (rows.length > 0 && rows[0].index <= target && rows[rows.length - 1].index >= target) {
      return;
    }
    const lastIndex = rows.length > 0 ? rows[rows.length - 1].index : 0;
    const firstIndex = rows.length > 0 ? rows[0].index : 0;
    const delta =
      firstIndex > target
        ? (target - firstIndex - 2) * 176
        : Math.max(176, (target - lastIndex - 4) * 176);
    await scroller.evaluate((element, amount) => {
      element.scrollTop += amount;
    }, delta);
    await page.waitForTimeout(80);
  }
  throw new Error(`Could not scroll the List to index ${target}`);
}

async function settleFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe("Real RSSReader List stress", () => {
  test("keeps mounts bounded and reaches item 900 in order", async ({ page }) => {
    const observerErrors: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("ResizeObserver loop")) observerErrors.push(message.text());
    });
    await openStress(page, { width: 1200, height: 800 });
    const mountedAtStart = await page.locator("[data-rss-list-card]").count();
    expect(mountedAtStart).toBeLessThanOrEqual(60);

    const scroller = page.locator(".rss-list-viewport");
    const listBox = (await scroller.boundingBox())!;
    expect(listBox.width).toBeLessThanOrEqual(421);
    expect(listBox.width).toBeGreaterThan(380);

    await scrollToIndex(page, 900);
    await expect(page.locator('[data-index="900"]')).toBeVisible();
    const rows = await virtualRows(page);
    expect(rows[0].index).toBeLessThanOrEqual(900);
    expect(rows[rows.length - 1].index).toBeGreaterThanOrEqual(900);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
    }

    const mountedAfterScroll = await page.locator("[data-rss-list-card]").count();
    expect(mountedAfterScroll).toBeLessThanOrEqual(60);

    const card = page.locator('[data-index="900"] [data-rss-list-card]');
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);

    // Record long tasks only around the disclosure interaction. Scrolling to
    // the row is navigation, not disclosure, and is measured separately.
    await page.evaluate(() => {
      const target = window as unknown as { __longTasks: Array<{ duration: number }> };
      target.__longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          target.__longTasks.push({ duration: entry.duration });
        }
      }).observe({ entryTypes: ["longtask"] });
    });
    await card.hover();
    await page.waitForTimeout(200);
    await expect(card.locator(".rss-list-details")).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(card.locator(".rss-list-details")).toBeHidden();

    const longTasks = (await page.evaluate(
      () => (window as unknown as { __longTasks: Array<{ duration: number }> }).__longTasks,
    )) as Array<{ duration: number }>;
    const disclosureLongTasks = longTasks.filter((task) => task.duration > 50);
    // The <50ms acceptance trace is recorded against the production bundle in
    // the manual performance pass; the Vite dev/React-dev server used here is
    // slower, so keep only a pathological-work smoke bound.
    test.info().annotations.push({
      type: "disclosure-longtasks",
      description: JSON.stringify(disclosureLongTasks),
    });
    expect(disclosureLongTasks.every((task) => task.duration < 200)).toBe(true);

    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.locator('[data-index="999"]')).toBeVisible({ timeout: 10_000 });
    const endRows = await virtualRows(page);
    for (let i = 1; i < endRows.length; i += 1) {
      expect(endRows[i].top).toBeGreaterThanOrEqual(endRows[i - 1].bottom - 1);
    }
    const spacerHeight = await page
      .locator(".rss-list-viewport > div")
      .evaluate((element) => element.getBoundingClientRect().height);
    const lastBottom = endRows[endRows.length - 1].bottom;
    const spacerTop = (await page.locator(".rss-list-viewport > div").boundingBox())!.y;
    expect(lastBottom - spacerTop).toBeLessThanOrEqual(spacerHeight + 1);
    expect(observerErrors).toHaveLength(0);
  });

  test("preserves the scroll anchor for an above-viewport expansion", async ({ page }) => {
    await openStress(page, { width: 1200, height: 800 });
    await scrollToIndex(page, 12);
    await page.locator('[data-index="12"]').scrollIntoViewIfNeeded();
    await settleFrames(page);

    const scroller = page.locator(".rss-list-viewport");
    const scrollerBox = (await scroller.boundingBox())!;
    const before = await page.evaluate((top) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(".rss-list-viewport [data-index]"),
      ).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          index: Number(element.getAttribute("data-index")),
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      return rows
        .filter((row) => row.bottom > top)
        .sort((a, b) => a.index - b.index)[0];
    }, scrollerBox.y);
    expect(before).toBeTruthy();

    const aboveIndex = 3;
    await page.evaluate((index) => {
      const row = document.querySelector<HTMLElement>(`.rss-list-viewport [data-index="${index}"]`);
      const toggle = row?.querySelector<HTMLButtonElement>(".rss-list-details-toggle");
      toggle?.focus({ preventScroll: true });
    }, aboveIndex);
    await expect(page.locator(`[data-index="${aboveIndex}"] [data-rss-list-card]`)).toHaveAttribute(
      "data-expanded",
      "true",
    );
    await settleFrames(page);

    const after = await page.evaluate(({ index }) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>(".rss-list-viewport [data-index]"),
      )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            index: Number(element.getAttribute("data-index")),
            top: rect.top,
            bottom: rect.bottom,
          };
        })
        .filter((candidate) => candidate.index === index)[0];
      return row;
    }, { index: before!.index });
    expect(after).toBeTruthy();
    expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(1);

    await page.keyboard.press("Escape");
    await expect(page.locator(`[data-index="${aboveIndex}"] [data-rss-list-card]`)).toHaveAttribute(
      "data-expanded",
      "false",
    );
    await settleFrames(page);
    const collapsed = await page.evaluate((index) => {
      const row = Array.from(
        document.querySelectorAll<HTMLElement>(".rss-list-viewport [data-index]"),
      )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            index: Number(element.getAttribute("data-index")),
            top: rect.top,
          };
        })
        .filter((candidate) => candidate.index === index)[0];
      return row;
    }, before!.index);
    expect(collapsed).toBeTruthy();
    expect(Math.abs(collapsed!.top - before!.top)).toBeLessThanOrEqual(1);
  });

  test("visible disclosure leaves scroll offset unchanged", async ({ page }) => {
    await openStress(page, { width: 1200, height: 800 });
    await scrollToIndex(page, 12);
    await page.locator('[data-index="12"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await settleFrames(page);
    const scroller = page.locator(".rss-list-viewport");
    const before = await scroller.evaluate((element) => element.scrollTop);
    const visible = page.locator('[data-index="12"] [data-rss-list-card]');
    await visible.hover();
    await page.waitForTimeout(180);
    await expect(visible.locator(".rss-list-details")).toBeVisible();
    const after = await scroller.evaluate((element) => element.scrollTop);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  test("scope changes remount shared article ids collapsed", async ({ page }) => {
    await openStress(page, { width: 1400, height: 1000 });
    const sharedCards = page.locator('[data-article-id="shared-article"]');
    await expect(sharedCards).toHaveCount(2);
    const first = sharedCards.first();
    await first.hover();
    await page.waitForTimeout(160);
    await expect(first).toHaveAttribute("data-expanded", "true");

    await page.getByText("Feed 0", { exact: true }).first().click();
    await expect(sharedCards).toHaveCount(1);
    await expect(sharedCards.first()).toHaveAttribute("data-expanded", "false");
    await expect(sharedCards.first().locator(".rss-list-details")).toBeHidden();

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(sharedCards).toHaveCount(2);
    await sharedCards.first().hover();
    await page
      .getByText("Feed 1", { exact: true })
      .first()
      .evaluate((element) => {
        (element.closest("button") as HTMLButtonElement | null)?.click();
      });
    await page.waitForTimeout(240);
    await expect(sharedCards).toHaveCount(1);
    await expect(sharedCards.first()).toHaveAttribute("data-expanded", "false");

    const favorite = page
      .locator('[data-index="0"] [data-rss-list-card] [data-rss-list-action="favorite"]')
      .first();
    await favorite.focus();
    await expect(favorite).toBeFocused();
    await favorite.press("Enter");
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await expect(favorite).toBeFocused();
  });

  test("next and previous article shortcuts still navigate the reader", async ({ page }) => {
    await openStress(page, { width: 1400, height: 1000 });
    await expect(page.locator("h2").filter({ hasText: "Article 0000" }).first()).toBeVisible();
    await page.keyboard.press("j");
    await expect(page.locator("h2").filter({ hasText: "Article 0001" }).first()).toBeVisible();
    await page.keyboard.press("k");
    await expect(page.locator("h2").filter({ hasText: "Article 0000" }).first()).toBeVisible();
  });

  test("real handlers preserve tag selection and training's selected-article semantics", async ({
    page,
  }) => {
    await openStress(page, { width: 1400, height: 1000 });
    const otherCard = page.locator('[data-index="1"] [data-rss-list-card]');
    await expect(otherCard).toHaveAttribute("data-read", "false");

    // The already selected article is index 0 (author Jane). Training opened
    // from index 1 (no author) must still describe the selected article.
    await otherCard.getByRole("button", { name: "Train intelligence" }).click();
    const training = page.getByRole("menu");
    await expect(training).toBeVisible();
    await expect(training.getByRole("button", { name: /Like author/ })).toBeEnabled();
    await page.mouse.click(5, 5);
    await expect(training).not.toBeVisible();

    // Tagging deliberately selects the row for the existing tag editor without
    // marking the article read or running normal article selection.
    await otherCard.getByRole("button", { name: "Tag article" }).click();
    await expect(page.getByPlaceholder("Add tags...")).toBeVisible();
    await expect(otherCard).toHaveAttribute("data-read", "false");
    await expect(page.locator("h2").filter({ hasText: "Article 0001" }).first()).toBeVisible();
  });

  test("preference changes through the customization UI update the List", async ({ page }) => {    await openStress(page, { width: 1400, height: 1000 });
    await page.getByRole("button", { name: "More options", exact: true }).click();
    await page.getByRole("menu").getByText("Customize", { exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByText("Layout", { exact: true }).click();
    await dialog.getByRole("radio", { name: /Tall/ }).check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    const card = page.locator("[data-rss-list-card]").first();
    await card.hover();
    await page.waitForTimeout(180);
    await expect(card.locator(".rss-list-excerpt")).toHaveClass(/rss-list-excerpt--4/);
  });
});

test.describe("Real RSSReader touch and mobile", () => {
  for (const width of [320, 390]) {
    test(`details open without navigation on ${width}px touch and the title opens the reader`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      const fixtures: RouteFixtures = { preferences: { ...RSS_DEFAULTS } };
      await openHarness(page, fixtures);
      await page.getByRole("button", { name: "list-stress", exact: true }).tap();
      const feedButton = page.getByText("Feed 0", { exact: true }).first();
      await expect(feedButton).toBeVisible({ timeout: 30_000 });
      await feedButton.tap();
      const card = page.locator("[data-rss-list-card]").first();
      await card.waitFor({ timeout: 30_000 });
      const controlBox = (await card.locator(".rss-list-actions > button").first().boundingBox())!;
      expect(controlBox.width).toBeGreaterThanOrEqual(47.5);
      expect(controlBox.height).toBeGreaterThanOrEqual(47.5);

      await card.locator(".rss-list-details-toggle").tap();
      await expect(card.locator(".rss-list-details")).toBeVisible();
      await expect(card).toHaveAttribute("data-expanded", "true");
      await expect(card.locator(".rss-list-title")).toBeVisible();
      await page.waitForTimeout(350);
      await card.locator(".rss-list-details-toggle").tap();
      await expect(card.locator(".rss-list-details")).toBeHidden();

      await card.locator(".rss-list-title").tap();
      await expect(page.locator("button[title='Back to articles']")).toBeVisible();
      await page.locator("button[title='Back to articles']").tap();
      await expect(page.locator("[data-rss-list-card]").first()).toBeVisible();
      await context.close();
    });
  }
});

