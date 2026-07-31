import { describe, expect, it } from "vitest";
import {
  actionMatchesQuery,
  getAllContextualActions,
  getActionsForView,
  type ViewAction,
} from "../contextualActions";

describe("contextualActions registry", () => {
  it("returns the right action set for each view", () => {
    expect(getActionsForView("document-viewer").every((a) => a.view === "document-viewer")).toBe(true);
    expect(getActionsForView("rss").every((a) => a.view === "rss")).toBe(true);
    expect(getActionsForView("podcast").every((a) => a.view === "podcast")).toBe(true);
    expect(getActionsForView("audiobook").every((a) => a.view === "audiobook")).toBe(true);
  });

  it("returns no actions for an unsupported view", () => {
    // @ts-expect-error -- deliberately unsupported view
    expect(getActionsForView("analytics")).toEqual([]);
  });

  it("hides format-gated actions when no format context is provided", () => {
    // With no viewerKind, paging actions are hidden by default (safe default);
    // non-gated actions are still returned.
    const all = getActionsForView("document-viewer");
    const ids = new Set(all.map((a) => a.id));
    expect(ids.has("doc.goToPage")).toBe(false);
    expect(ids.has("doc.search")).toBe(true);
    expect(ids.has("doc.toggleFullscreen")).toBe(true);
  });

  it("hides paging actions for non-paginated formats", () => {
    const markdown = getActionsForView("document-viewer", { viewerKind: "markdown" });
    const ids = new Set(markdown.map((a) => a.id));
    expect(ids.has("doc.goToPage")).toBe(false);
    expect(ids.has("doc.nextPage")).toBe(false);
    expect(ids.has("doc.prevPage")).toBe(false);
    expect(ids.has("doc.toggleToc")).toBe(false);

    const pdf = getActionsForView("document-viewer", { viewerKind: "pdf" });
    const pdfIds = new Set(pdf.map((a) => a.id));
    expect(pdfIds.has("doc.goToPage")).toBe(true);
    expect(pdfIds.has("doc.toggleToc")).toBe(true);

    // EPUB is paginated (paging actions show) but has no toggleable TOC panel.
    const epub = getActionsForView("document-viewer", { viewerKind: "epub" });
    const epubIds = new Set(epub.map((a) => a.id));
    expect(epubIds.has("doc.goToPage")).toBe(true);
    expect(epubIds.has("doc.toggleToc")).toBe(false);
  });

  it("hides episode/article-targeted actions when there is no target item", () => {
    const rss = getActionsForView("rss", { hasTargetItem: false });
    const ids = new Set(rss.map((a) => a.id));
    expect(ids.has("rss.markRead")).toBe(false);
    expect(ids.has("rss.toggleStar")).toBe(false);
    expect(ids.has("rss.refreshFeed")).toBe(true); // not target-dependent

    const pod = getActionsForView("podcast", { hasTargetItem: false });
    const podIds = new Set(pod.map((a) => a.id));
    expect(podIds.has("podcast.playPause")).toBe(false);
    expect(podIds.has("podcast.refreshFeed")).toBe(true);
  });

  it("hides vim action when vim is unavailable", () => {
    const noVim = getActionsForView("document-viewer", { vimAvailable: false });
    expect(noVim.some((a) => a.id === "doc.toggleVimMode")).toBe(false);
    const withVim = getActionsForView("document-viewer", { vimAvailable: true });
    expect(withVim.some((a) => a.id === "doc.toggleVimMode")).toBe(true);
  });

  it("every action has a unique id within its view", () => {
    for (const view of ["document-viewer", "rss", "podcast", "audiobook"] as const) {
      const ids = getActionsForView(view).map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every action declares the view it belongs to", () => {
    for (const action of getAllContextualActions()) {
      expect(action.view).toBeTruthy();
      expect(typeof action.title).toBe("string");
      expect(action.title.length).toBeGreaterThan(0);
    }
  });
});

describe("actionMatchesQuery", () => {
  const find = (id: string): ViewAction =>
    getAllContextualActions().find((a) => a.id === id)!;

  it("matches everything on an empty query", () => {
    expect(actionMatchesQuery(find("audiobook.addBookmark"), "")).toBe(true);
    expect(actionMatchesQuery(find("audiobook.addBookmark"), "   ")).toBe(true);
  });

  it("matches by title substring (case-insensitive)", () => {
    expect(actionMatchesQuery(find("audiobook.addBookmark"), "bookmark")).toBe(true);
    expect(actionMatchesQuery(find("audiobook.addBookmark"), "BOOKM")).toBe(true);
  });

  it("matches by keyword", () => {
    // "save" is a keyword of the bookmark action, not in the title
    expect(actionMatchesQuery(find("audiobook.addBookmark"), "save")).toBe(true);
  });

  it("does not match unrelated queries", () => {
    expect(actionMatchesQuery(find("audiobook.addBookmark"), "zoom")).toBe(false);
  });
});
