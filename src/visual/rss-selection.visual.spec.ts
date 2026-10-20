import { expect, test, type Page } from "@playwright/test";
import { RSS_DEFAULTS } from "../types/rssCustomization";

/**
 * RSS article selection preservation regression.
 *
 * The fixture mounts the three real selection-menu consumers (inline reader,
 * full-content view, Story view) with deterministic article text. Real mouse
 * drags make the native selection, then a real secondary-button press opens
 * the shared menu. Every stage asserts the native selection text and range
 * (non-collapsed) rather than only the action payload.
 *
 * Run: npx playwright test src/visual/rss-selection.visual.spec.ts --workers=1
 */

declare global {
  interface Window {
    rssSelectionHarness: {
      setView: (view: "reader" | "full" | "story") => void;
      setArticle: (articleId: string) => void;
      setContentVersion: (version: number) => void;
      bump: () => void;
      state: () => { view: string; articleId: string; contentVersion: number };
    };
  }
}

const ARTICLE_HTML =
  "<p>The first paragraph gives the reader a stable target sentence for selection.</p>" +
  "<p>A second paragraph carries <strong>formatted text</strong> so a selected range can cross <em>inline elements</em>.</p>" +
  '<p>The third paragraph keeps enough words to make a backward selection practical. <a href="https://example.com/source">Source link</a></p>' +
  '<p><img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'120\' height=\'60\'%3E%3Crect width=\'120\' height=\'60\' fill=\'rebeccapurple\'/%3E%3C/svg%3E" alt="Fixture image" /></p>';

const ARTICLE_B_HTML =
  "<p>Beta article begins with different words for the replacement article.</p>" +
  "<p>Beta article keeps a second paragraph so a stale range cannot survive.</p>";

type View = "reader" | "full" | "story";

interface Snapshot {
  text: string;
  rangeCount: number;
  collapsed: boolean;
  rectCount: number;
}

async function mockRssApi(page: Page): Promise<void> {
  let prefs: Record<string, unknown> = { ...RSS_DEFAULTS };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown = [];
    if (path === "/api/rss/preferences") {
      if (route.request().method() === "PUT") {
        prefs = { ...prefs, ...(route.request().postDataJSON() as Record<string, unknown>) };
      }
      body = { ...prefs, id: "default", date_created: "2026-01-01", date_modified: "2026-01-01" };
    } else if (path === "/api/rss/feeds") {
      body = [
        {
          id: "feed-a",
          url: "https://example.com/rss",
          title: "Science Feed",
          description: "Science",
          update_interval: 3600,
          is_active: true,
          date_added: "2026-01-01",
          unread_count: 2,
        },
      ];
    } else if (path.endsWith("/articles")) {
      body = [
        {
          id: "article-a",
          feed_id: "feed-a",
          title: "Alpha article",
          author: "Jane",
          url: "https://example.com/article-a",
          published_date: "2026-10-01",
          date_added: "2026-10-01",
          is_read: false,
          is_queued: false,
          summary: "Deterministic selection fixture",
          content: ARTICLE_HTML,
        },
        {
          id: "article-b",
          feed_id: "feed-a",
          title: "Beta article",
          author: "Jane",
          url: "https://example.com/article-b",
          published_date: "2026-10-01",
          date_added: "2026-10-01",
          is_read: false,
          is_queued: false,
          summary: "Replacement selection fixture",
          content: ARTICLE_B_HTML,
        },
      ];
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function openView(page: Page, view: View): Promise<void> {
  await page.locator(`[data-harness-view="${view}"]`).click();
  if (view === "reader") {
    const row = page.locator('[data-article-id="article-a"]').first();
    await row.waitFor();
    await row.click();
  }
  await page.locator("#rss-fixture .rss-reading-prose p").first().waitFor();
}

async function selectionSnapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    return {
      text: selection?.toString() ?? "",
      rangeCount: selection?.rangeCount ?? 0,
      collapsed: selection?.isCollapsed ?? true,
      rectCount:
        selection && selection.rangeCount > 0
          ? selection.getRangeAt(0).getClientRects().length
          : 0,
    };
  });
}

async function selectAcrossParagraphs(page: Page, backwards = false): Promise<void> {
  const points = await page.evaluate(() => {
    const paragraphs = Array.from(
      document.querySelectorAll<HTMLElement>("#rss-fixture .rss-reading-prose p"),
    );
    if (paragraphs.length < 3) throw new Error(`expected 3 paragraphs, found ${paragraphs.length}`);
    function edge(paragraph: HTMLElement, offset: number) {
      const text = paragraph.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("missing text node");
      const range = document.createRange();
      const at = Math.min(offset, text.textContent?.length ?? 0);
      range.setStart(text, at);
      range.setEnd(text, at);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    }
    return {
      start: edge(paragraphs[0], 4),
      end: edge(paragraphs[2], Math.max(4, (paragraphs[2].textContent?.length ?? 10) - 14)),
    };
  });

  const from = backwards ? points.end : points.start;
  const to = backwards ? points.start : points.end;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function rightClickInSelection(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) throw new Error("no selection");
    const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (rects.length === 0) throw new Error("selection has no client rects");
    const rect = rects[Math.min(1, rects.length - 1)];
    return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { button: "right" });
}

async function openSelectionMenu(
  page: Page,
  backwards = false,
): Promise<{ before: Snapshot; after: Snapshot }> {
  await selectAcrossParagraphs(page, backwards);
  const before = await selectionSnapshot(page);
  expect(before.text.trim().length).toBeGreaterThan(40);
  expect(before.collapsed).toBe(false);

  await rightClickInSelection(page);
  await expect(page.getByRole("menu")).toBeVisible();
  await expect
    .poll(async () => (await selectionSnapshot(page)).text)
    .toBe(before.text);
  const after = await selectionSnapshot(page);
  expect(after.collapsed).toBe(false);
  expect(after.rangeCount).toBe(1);
  expect(after.rectCount).toBeGreaterThan(0);
  return { before, after };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await mockRssApi(page);
  await page.goto("/rss-selection-harness.html");
  await page.locator('[data-harness-view="story"]').waitFor();
});

for (const view of ["reader", "full", "story"] as const) {
  test(`${view}: immediate right-click keeps the selected passage visible`, async ({ page }) => {
    await openView(page, view);
    const { before, after } = await openSelectionMenu(page);

    expect(after.text).toContain("formatted text");
    expect(after.text).toContain("inline elements");
    expect(after.text).toBe(before.text);
    await page.screenshot({
      path: `.playwright/results/rss-selection-${view}-menu-open.png`,
    });
  });

  test(`${view}: forward and backward multi-paragraph selections survive the menu`, async ({
    page,
  }) => {
    await openView(page, view);

    for (const backwards of [false, true]) {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await openSelectionMenu(page, backwards);
      expect(await page.evaluate(() => window.getSelection()?.anchorNode?.isConnected)).toBe(true);
    }
  });
}

for (const view of ["reader", "full", "story"] as const) {
  test(`${view}: Highlight submenu keeps the passage selected`, async ({ page }) => {
    await openView(page, view);
    const { before } = await openSelectionMenu(page);

    await page.getByRole("menuitem", { name: "Highlight" }).hover();
    const yellow = page.getByRole("menuitem", { name: "Yellow highlight" });
    await expect(yellow).toBeVisible();
    expect((await selectionSnapshot(page)).text).toBe(before.text);

    await page.screenshot({
      path: `.playwright/results/rss-selection-${view}-submenu-open.png`,
    });

    const box = await yellow.boundingBox();
    if (!box) throw new Error("submenu item has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // The pressed item must not have collapsed the selection before dispatch.
    expect((await selectionSnapshot(page)).text).toBe(before.text);
    await page.mouse.up();
  });
}

test("unchanged article rerender keeps the selection and text nodes", async ({ page }) => {
  await openView(page, "story");
  const { before } = await openSelectionMenu(page);

  await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("#rss-fixture .rss-reading-prose p"),
    );
    (window as unknown as { __selectionNodes: Node[] }).__selectionNodes = nodes;
    window.rssSelectionHarness.bump();
  });
  await expect(page.getByRole("menu")).toBeVisible();

  await expect
    .poll(async () => (await selectionSnapshot(page)).text)
    .toBe(before.text);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __selectionNodes: Node[] }
      ).__selectionNodes.every((node) => node.isConnected),
    ),
  ).toBe(true);
  await page.screenshot({ path: ".playwright/results/rss-selection-story-unchanged-rerender.png" });
});

test("reader: unchanged-content update keeps the virtualized article nodes", async ({ page }) => {
  await openView(page, "reader");
  const { before } = await openSelectionMenu(page);

  await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("#rss-fixture .rss-reading-prose p"),
    );
    (window as unknown as { __selectionNodes: Node[] }).__selectionNodes = nodes;
    window.rssSelectionHarness.bump();
  });
  await expect(page.getByRole("menu")).toBeVisible();
  expect((await selectionSnapshot(page)).text).toBe(before.text);
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __selectionNodes: Node[] }
      ).__selectionNodes.every((node) => node.isConnected),
    ),
  ).toBe(true);
});

test("Escape keeps the passage and a second right-click reopens the menu", async ({ page }) => {
  await openView(page, "story");
  const { before } = await openSelectionMenu(page);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  const escaped = await selectionSnapshot(page);
  expect(escaped.text).toBe(before.text);
  expect(escaped.collapsed).toBe(false);

  await rightClickInSelection(page);
  await expect(page.getByRole("menu")).toBeVisible();
  expect((await selectionSnapshot(page)).text).toBe(before.text);
});

test("outside click dismisses without restoring the old passage", async ({ page }) => {
  await openView(page, "story");
  await openSelectionMenu(page);

  await page.locator('[data-harness-view="story"]').click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  // An outside click dismisses the menu. If the browser clears the selection,
  // it must stay cleared: the old range is never restored after dismissal.
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.waitForTimeout(120);
  expect((await selectionSnapshot(page)).text).toBe("");
});

for (const view of ["full", "story"] as const) {
  test(`${view}: article change closes the menu and invalidates the old passage`, async ({
    page,
  }) => {
    await openView(page, view);
    await openSelectionMenu(page);

    await page.evaluate(() => window.rssSelectionHarness.setArticle("article-b"));
    await expect(page.getByText("Beta article begins with different words")).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(async () => (await selectionSnapshot(page)).text).not.toContain("formatted text");

    const text = await selectionSnapshot(page);
    if (text.text.trim()) {
      // A still-live native selection must be inside the new article; the
      // retained old range must never be restored afterwards.
      await page.waitForTimeout(120);
      expect((await selectionSnapshot(page)).text).toBe(text.text);
    }
  });

  test(`${view}: content replacement closes the menu and invalidates the old passage`, async ({
    page,
  }) => {
    await openView(page, view);
    await openSelectionMenu(page);

    await page.evaluate(() => window.rssSelectionHarness.setContentVersion(1));
    await expect(page.getByText("Replacement content for article-a")).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect.poll(async () => (await selectionSnapshot(page)).text).not.toContain("formatted text");
  });
}

test("reader: article change closes the menu and invalidates the old passage", async ({ page }) => {
  await openView(page, "reader");
  await openSelectionMenu(page);

  // Clicking via the DOM keeps the menu open until the article identity change
  // (a real pointer click would dismiss it as an outside click first).
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-article-id="article-b"]')?.click();
  });
  await expect(page.getByText("Beta article begins with different words")).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect.poll(async () => (await selectionSnapshot(page)).text).not.toContain("formatted text");
});

test("no selection keeps native link and image menus untouched", async ({ page }) => {
  await openView(page, "story");
  await page.evaluate(() => window.getSelection()?.removeAllRanges());

  await page.locator("#rss-fixture .rss-reading-prose a").scrollIntoViewIfNeeded();
  await page.locator("#rss-fixture .rss-reading-prose a").click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);

  await page.locator("#rss-fixture .rss-reading-prose img").scrollIntoViewIfNeeded();
  await page.locator("#rss-fixture .rss-reading-prose img").click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test.describe("mobile viewport", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("touch tap does not open the selection menu, and a touch-created range keeps its passage", async ({
    page,
  }) => {
    await openView(page, "story");
    const paragraph = page.locator("#rss-fixture .rss-reading-prose p").first();
    await paragraph.tap();
    await expect(page.getByRole("menu")).toHaveCount(0);

    // Simulate the range a native touch selection leaves behind, then the
    // platform contextmenu event that follows a long-press.
    const before = await page.evaluate(() => {
      const paragraphs = Array.from(
        document.querySelectorAll<HTMLElement>("#rss-fixture .rss-reading-prose p"),
      );
      const range = document.createRange();
      range.setStart(paragraphs[0].firstChild as Node, 4);
      range.setEnd(paragraphs[0].firstChild as Node, 40);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const rect = range.getBoundingClientRect();
      const target = paragraphs[0];
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.left + 12,
          clientY: rect.top + rect.height / 2,
        }),
      );
      return selection?.toString() ?? "";
    });

    await expect(page.getByRole("menu")).toBeVisible();
    await expect.poll(async () => (await selectionSnapshot(page)).text).toBe(before);
  });
});
