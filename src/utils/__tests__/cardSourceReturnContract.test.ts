/**
 * Return-navigation contract tests (flashcard → source → back to flashcard).
 *
 * The study session survives the round trip because the review tab is a
 * singleton that stays mounted behind the reader tab and is never evicted by
 * either tab cap. These tests pin the store-level invariants that guarantee
 * that: if a future change makes "review" evictable or multi-instance, the
 * ReviewTab unmount reset would silently destroy in-progress sessions.
 */

import { describe, it, expect } from "vitest";

describe("review tab return contract", () => {
  it("review tabs are never evicted by the resident or reader caps", { timeout: 30000 }, async () => {
    const tabsStore = await import("../../stores/tabsStore");
    expect(tabsStore.isTabTypeEvictable("review")).toBe(false);
    // The reader cap only governs document readers; review is not one.
    expect(tabsStore.isTabTypeReader("review")).toBe(false);
  });

  it("review is a singleton tab type so returning re-activates the same tab", async () => {
    // addTab dedupes singleton types, so the reader's return button (which
    // targets the single review tab) can never race a duplicate instance.
    const { useTabsStore } = await import("../../stores/tabsStore");
    const addTab = useTabsStore.getState().addTab;
    const tabPayload = {
      title: "Review",
      type: "review" as const,
      icon: null,
      content: () => null,
      closable: false,
    };
    const first = addTab(tabPayload);
    const second = addTab({ ...tabPayload });
    expect(second).toBe(first);
    expect(
      useTabsStore.getState().tabs.filter((tab) => tab.type === "review")
    ).toHaveLength(1);
  });

  it("openDocumentAtLocation forwards the reviewReturn context into the tab payload", async () => {
    const { openDocumentAtLocation } = await import("../../utils/openDocumentAtLocation");
    const { useDocumentStore } = await import("../../stores/documentStore");
    const { useTabsStore } = await import("../../stores/tabsStore");

    // Seed a document so the helper takes the synchronous path.
    useDocumentStore.setState({
      documents: [
        {
          id: "doc-1",
          title: "Memory Systems",
          fileType: "html",
        } as never,
      ],
    });
    const addTab = useTabsStore.getState().addTab;

    openDocumentAtLocation(
      "doc-1",
      { highlightQuery: "hippocampus", initialJump: { kind: "html", textQuote: "hippocampus" } },
      addTab,
      { reviewReturn: true, originTabId: "review-tab" }
    );

    const viewerTab = useTabsStore
      .getState()
      .tabs.find((tab) => tab.type === "document-viewer");
    expect(viewerTab).toBeDefined();
    expect(viewerTab?.data).toMatchObject({
      documentId: "doc-1",
      highlightQuery: "hippocampus",
      reviewReturn: true,
      originTabId: "review-tab",
    });
    expect(typeof viewerTab?.data?.jumpRequestId).toBe("string");
  });

  it("re-targets an already-open reader tab instead of duplicating it", async () => {
    const { openDocumentAtLocation } = await import("../../utils/openDocumentAtLocation");
    const { useDocumentStore } = await import("../../stores/documentStore");
    const { useTabsStore } = await import("../../stores/tabsStore");

    useDocumentStore.setState({
      documents: [{ id: "doc-2", title: "Second Doc", fileType: "html" } as never],
    });
    const addTab = useTabsStore.getState().addTab;

    openDocumentAtLocation("doc-2", {}, addTab);
    const before = useTabsStore
      .getState()
      .tabs.filter((tab) => tab.type === "document-viewer" && tab.data?.documentId === "doc-2");
    expect(before).toHaveLength(1);

    openDocumentAtLocation(
      "doc-2",
      { initialJump: { kind: "html", textQuote: "later passage" } },
      addTab,
      { reviewReturn: true }
    );

    const after = useTabsStore
      .getState()
      .tabs.filter((tab) => tab.type === "document-viewer" && tab.data?.documentId === "doc-2");
    expect(after).toHaveLength(1);
    expect(after[0].data?.reviewReturn).toBe(true);
  });
});
