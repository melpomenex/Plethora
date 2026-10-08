import { describe, expect, it } from "vitest";

import {
  LONG_PRESS_MS,
  canPostponeQueueItemType,
  clampMenuPosition,
  deckMenuItemIds,
  deckTagMenuItemIds,
  docQACitationMenuItemIds,
  flashcardMenuItemIds,
  queueMenuItemIds,
  rssArticleMenuItemIds,
  rssFeedMenuItemIds,
  shouldYieldRowMenu,
  shouldYieldToNative,
  toolbarMenuItemIds,
} from "../contextMenus";

describe("clampMenuPosition", () => {
  it("keeps the origin when the menu fits", () => {
    expect(clampMenuPosition(100, 100, { w: 220, h: 300 }, { w: 1280, h: 800 }))
      .toEqual({ x: 100, y: 100 });
  });

  it("pulls an overflowing menu inside the viewport", () => {
    const pos = clampMenuPosition(1200, 750, { w: 220, h: 300 }, { w: 1280, h: 800 });
    expect(pos.x).toBeLessThanOrEqual(1280 - 220 - 8);
    expect(pos.y).toBeLessThanOrEqual(800 - 300 - 8);
    expect(pos.x).toBeGreaterThanOrEqual(8);
    expect(pos.y).toBeGreaterThanOrEqual(8);
  });

  it("never reports a negative origin on tiny viewports", () => {
    const pos = clampMenuPosition(0, 0, { w: 500, h: 500 }, { w: 100, h: 100 });
    expect(pos.x).toBeGreaterThanOrEqual(8);
    expect(pos.y).toBeGreaterThanOrEqual(8);
  });
});

describe("yield rules", () => {
  it("row menus yield only to in-progress edits", () => {
    const input = document.createElement("input");
    const link = document.createElement("a");
    link.setAttribute("href", "https://example.com");
    const row = document.createElement("div");
    expect(shouldYieldRowMenu(input)).toBe(true);
    expect(shouldYieldRowMenu(link)).toBe(false);
    expect(shouldYieldRowMenu(row)).toBe(false);
    expect(shouldYieldRowMenu(null)).toBe(false);
  });

  it("generic menus yield to editables, links, and media", () => {
    const input = document.createElement("textarea");
    const img = document.createElement("img");
    const row = document.createElement("div");
    expect(shouldYieldToNative(input)).toBe(true);
    expect(shouldYieldToNative(img)).toBe(true);
    expect(shouldYieldToNative(row)).toBe(false);
  });
});

describe("deckMenuItemIds", () => {
  it("follows the spec order with danger last behind a separator", () => {
    for (const opts of [{ isEmpty: false, isActiveFocus: false }, { isEmpty: true, isActiveFocus: true }]) {
      expect(deckMenuItemIds(opts)).toEqual([
        "start-review",
        "preview-cards",
        "toggle-focus",
        "rename",
        "edit-tags",
        "export-apkg",
        "sep:1",
        "delete",
      ]);
    }
  });
});

describe("queueMenuItemIds", () => {
  it("matches QueueContextMenu gating: edit only for learning-items, postpone only when postponable", () => {
    expect(queueMenuItemIds("learning-item", true)).toEqual([
      "start-review", "edit-card", "postpone", "mark-done", "copy-title", "sep:1", "remove",
    ]);
    // No edit handler (e.g. read-only surface): edit hidden, not disabled.
    expect(queueMenuItemIds("learning-item", false)).not.toContain("edit-card");
    // Non-postponable types hide Smart postpone while keeping the rest.
    expect(queueMenuItemIds("extract", false)).toEqual([
      "start-review", "mark-done", "copy-title", "sep:1", "remove",
    ]);
    expect(queueMenuItemIds("document", false)).toContain("postpone");
  });

  it("canPostponeQueueItemType mirrors QueueContextMenu.canPostpone", () => {
    expect(canPostponeQueueItemType("learning-item")).toBe(true);
    expect(canPostponeQueueItemType("document")).toBe(true);
    expect(canPostponeQueueItemType("extract")).toBe(false);
    expect(canPostponeQueueItemType("podcast")).toBe(false);
  });
});

describe("rssArticleMenuItemIds", () => {
  it("flips the read toggle label instead of showing both", () => {
    const read = rssArticleMenuItemIds({ read: true, favorite: false, hasFullContent: true });
    expect(read).toContain("mark-unread");
    expect(read).not.toContain("mark-read");
    const unread = rssArticleMenuItemIds({ read: false, favorite: true, hasFullContent: false });
    expect(unread).toContain("mark-read");
    expect(unread).not.toContain("mark-unread");
    expect(unread).toContain("remove-favorite");
    expect(unread).toContain("fetch-full");
    expect(read).not.toContain("fetch-full");
  });

  it("keeps danger-adjacent destructive action last", () => {
    const ids = rssArticleMenuItemIds({ read: false, favorite: false, hasFullContent: true });
    expect(ids[ids.length - 1]).toBe("mark-all-read");
    expect(ids).toContain("sep:1");
  });
});

describe("remaining surfaces", () => {
  it("feed, tag, flashcard, toolbar, and citation menus keep stable orders", () => {
    expect(rssFeedMenuItemIds()).toEqual(
      ["refresh", "mark-all-read", "copy-feed-url", "sep:1", "rename", "sep:2", "unsubscribe"],
    );
    expect(deckTagMenuItemIds()).toEqual(["copy-tag", "remove-tag"]);
    expect(flashcardMenuItemIds()).toEqual(["edit", "preview", "copy-question", "sep:1", "delete"]);
    expect(toolbarMenuItemIds(true)).toEqual(["open", "open-background"]);
    expect(toolbarMenuItemIds(false)).toEqual(["open"]);
    expect(docQACitationMenuItemIds()).toEqual(["open-source", "copy-citation"]);
  });

  it("long-press delay matches the existing 500ms convention", () => {
    expect(LONG_PRESS_MS).toBe(500);
  });
});
