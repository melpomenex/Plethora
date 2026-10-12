import { expect, test } from "@playwright/test";
import { RSS_DEFAULTS } from "../types/rssCustomization";
import type { RssUserPreferenceUpdate } from "../types/rssCustomization";
declare global {
  interface Window {
    rssHarness: {
      setPreferences: (patch: RssUserPreferenceUpdate) => void;
      setView: (view: string) => void;
      reload: () => Promise<void>;
    };
  }
}
test.beforeEach(async ({ page }) => {
  let prefs = { ...RSS_DEFAULTS };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }
    let body: unknown = [];
    if (path === "/api/rss/preferences") {
      if (route.request().method() === "PUT")
        prefs = { ...prefs, ...route.request().postDataJSON() };
      body = { ...prefs, id: "default", date_created: "2026-01-01", date_modified: "2026-01-01" };
    } else if (path === "/api/rss/feeds")
      body = [
        {
          id: "feed-a",
          url: "https://example.com/rss",
          title: "Science Feed",
          description: "Science",
          update_interval: 3600,
          is_active: true,
          date_added: "2026-01-01",
          unread_count: 1,
        },
      ];
    else if (path.endsWith("/articles"))
      body = [
        {
          id: "article-a",
          feed_id: "feed-a",
          title: "Alpha article",
          author: "Jane",
          url: "https://example.com/article",
          published_date: "2026-10-01",
          date_added: "2026-10-01",
          is_read: false,
          is_queued: false,
          summary: "Article paragraph",
          content: "<p>Article paragraph for reading appearance verification.</p>",
        },
      ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto("/rss-customization-harness.html");
  await page.getByText("Customize fixture", { exact: true }).waitFor();
});
for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 1000 },
]) {
  test(`reader styles and dialog layer ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.evaluate(() =>
      window.rssHarness.setPreferences({
        font_size: 24,
        line_height: 1.7,
        font_family: "monospace",
        text_align: "justify",
        content_width: 40,
        theme_mode: "light",
      })
    );
    for (const view of ["basic", "story", "full", "scroll"]) {
      await page.evaluate((view) => window.rssHarness.setView(view), view);
      const paragraph = page.locator("#rss-fixture .rss-reading-prose p").first();
      await paragraph.waitFor();
      await expect(paragraph).toHaveCSS("font-size", "24px");
      await expect(paragraph).toHaveCSS("line-height", "40.8px");
      await expect(paragraph).toHaveCSS("text-align", "justify");
      await expect(paragraph).toHaveCSS("font-family", "monospace");
      await expect(paragraph).toHaveCSS("color", "rgb(15, 23, 42)");
      await page.evaluate(() => window.rssHarness.setPreferences({ theme_mode: "dark" }));
      await expect(paragraph).toHaveCSS("color", "rgb(248, 250, 252)");
      await page.evaluate(() => window.rssHarness.setPreferences({ theme_mode: "light" }));
    }
    await page.getByText("Customize fixture", { exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    const hit = await page.evaluate(() => {
      const toolbar = document.getElementById("bottom-toolbar")!.getBoundingClientRect();
      const top = document.elementFromPoint(20, toolbar.y + 20);
      return !top?.closest("#bottom-toolbar");
    });
    expect(hit).toBe(true);
    await page.getByText("Reader", { exact: true }).click();
    await expect(page.getByLabel("Font Size")).toHaveValue("24");
    await page.getByLabel("Font Size").fill("28");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await page.screenshot({ path: `.playwright/results/rss-modal-${viewport.width}.png` });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Customize fixture", { exact: true })).toBeFocused();
    await page.evaluate(() => window.rssHarness.reload());
    await page.evaluate(() => window.rssHarness.setView("story"));
    await expect(page.locator(".rss-reading-prose p").first()).toHaveCSS("font-size", "28px");
  });
}
test("columns and independent thumbnail/card settings", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    window.rssHarness.setView("magazine");
    window.rssHarness.setPreferences({
      column_count: 4,
      thumbnail_size: "large",
      card_height: "tall",
    });
  });
  const grid = page.locator(".rss-article-grid");
  await grid.waitFor();
  expect(
    await grid.evaluate((el) => Number(getComputedStyle(el).columnCount))
  ).toBe(4);
  const image = grid.locator("article > div > img").last();
  const large = (await image.boundingBox())!.width;
  await page.evaluate(() => window.rssHarness.setPreferences({ thumbnail_size: "small" }));
  await expect.poll(async () => (await image.boundingBox())!.width).toBeLessThan(large);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await grid.evaluate((el) => Number(getComputedStyle(el).columnCount))
  ).toBe(1);
});

test("standard RSS reader reflects saved controls", async ({page}) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>window.rssHarness.setView("standard"));
  const article = page.locator('[data-article-id="article-a"]').first();await article.waitFor();await article.click();
  const paragraph = page.locator("#rss-fixture .rss-reading-prose p").first();await paragraph.waitFor();
  const customize = page.getByRole("button", {name:"Customize",exact:true});
  if(await customize.isVisible()) await customize.click();
  else { await page.getByRole("button",{name:"More options",exact:true}).click(); await customize.click(); }
  await page.getByText("Reader",{exact:true}).click();await page.getByLabel("Font Size").fill("24");
  await page.getByRole("button",{name:"Save",exact:true}).click();await expect(page.getByRole("button",{name:"Save",exact:true})).toBeDisabled();
  await page.keyboard.press("Escape");await expect(paragraph).toHaveCSS("font-size","24px");
});

test("layout density, presentation, excerpts and metadata controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const view of ["magazine", "grid"]) {
    await page.evaluate((view) => window.rssHarness.setView(view), view);
    const card = page.locator("#rss-fixture article").first();
    for (const [density, padding] of [["compact", "8px"], ["normal", "12px"], ["comfortable", "20px"]]) {
      await page.evaluate((density) => window.rssHarness.setPreferences({ density }), density);
      await expect(card.locator(":scope > div")).toHaveCSS("padding-top", padding);
    }
    await page.evaluate(() => window.rssHarness.setPreferences({
      view_mode: "card", thumbnail_size: "large", card_height: "tall", excerpt_length: 50,
      show_author: true, show_date: true, show_feed_icon: true, show_thumbnails: true,
    }));
    await expect(card.locator(":scope > div")).toHaveCSS("flex-direction", "column");
    await expect(card.getByText("by Jane", { exact: true })).toBeVisible();
    await expect(card.locator("p")).toHaveClass(/line-clamp-6/);
    await expect.poll(async () => (await card.locator("p").textContent())!.length).toBeLessThan(55);
    await page.evaluate(() => window.rssHarness.setPreferences({ view_mode: "list" }));
    await expect(card.locator(":scope > div")).toHaveCSS("flex-direction", "row");
    await page.evaluate(() => window.rssHarness.setPreferences({
      show_author: false, show_date: false, show_feed_icon: false, show_thumbnails: false,
      card_height: "compact",
    }));
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card.getByText("by Jane", { exact: true })).toHaveCount(0);
    await expect(card.locator("p")).toHaveCount(0);
    await page.evaluate(() => window.rssHarness.setPreferences({
      view_mode: "compact", show_thumbnails: true, card_height: "tall",
    }));
    await expect(card.locator("img")).toHaveCount(0);
    await expect(card.locator("p")).toHaveCount(0);
  }
});

test("standard virtualized articles scroll at every density and presentation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/rss/feeds/*/articles?*", async route => {
    await route.fulfill({ json: Array.from({ length: 50 }, (_, i) => ({
      id: `virtual-${i}`, feed_id: "feed-a", title: `Article ${String(i).padStart(2, "0")}`,
      url: `https://example.com/${i}`, date_added: "2026-10-01", published_date: "2026-10-01",
      is_read: false, is_queued: false, author: "Jane", summary: "Paragraph for the article excerpt.",
      content: "<p>Paragraph for the article excerpt.</p>",
    })) });
  });
  for (const view_mode of ["card", "list", "compact"]) {
    for (const [density, padding] of [["compact", "8px"], ["normal", view_mode === "compact" ? "6px" : "12px"], ["comfortable", "16px"]]) {
      await page.evaluate(() => window.rssHarness.setView("basic"));
      await expect(page.locator("[data-article-id]")).toHaveCount(0);
      await page.evaluate(async patch => {
        await fetch("/api/rss/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
        window.rssHarness.setView("standard");
      }, { density, view_mode, sort_by: "title", sort_order: "asc" });
      const first = page.locator('[data-article-id="virtual-0"]');
      await expect(first).toHaveCSS("padding-top", padding);
      if (view_mode === "compact") await expect(first.locator("p")).toHaveCount(0);
      else await expect(first.locator("p")).toBeVisible();
      // The nearest scroll container owns virtual row measurements.
      const scroller = await first.evaluateHandle(el => {
        let parent = el.parentElement;
        while (parent && !["auto", "scroll"].includes(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
        if (!parent) throw new Error("Missing article scroll container");
        return parent;
      });
      await expect.poll(async () => {
        await scroller.evaluate(parent => { parent.scrollTop = parent.scrollHeight; });
        return page.locator('[data-article-id="virtual-49"]').count();
      }).toBe(1);
      await expect(page.locator('[data-article-id="virtual-49"]')).toBeVisible();
      await scroller.dispose();
    }
  }
});
