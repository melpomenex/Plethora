/**
 * Queue navigation (#11 hardening follow-up).
 *
 * `openDocumentViewer` routes through the same timeout+retry lazy wrapper
 * (`importWithRetry`) as every other document-viewer tab, so a cold WebView
 * chunk stall self-heals in place. This verifies the added tab's lazy content
 * resolves to the real DocumentViewer and renders on the FIRST visit — the
 * navigationFirstView-style coverage pattern.
 */
import { Suspense } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQueueNavigation } from "../useQueueNavigation";
import { useQueueStore } from "../../stores/queueStore";
import { useTabsStore } from "../../stores/tabsStore";
import type { QueueItem } from "../../types";

vi.mock("../../components/viewer/DocumentViewerWrapper", () => ({
  DocumentViewer: () => <div>Queue Document Viewer</div>,
}));

const item: QueueItem = {
  id: "item-1",
  documentId: "doc-1",
  documentTitle: "Doc One",
  itemType: "document",
  priority: 5,
  estimatedTime: 10,
  tags: [],
  progress: 0,
};

describe("useQueueNavigation", () => {
  beforeEach(() => {
    useQueueStore.setState({ items: [], filteredItems: [] });
    useTabsStore.setState({ tabs: [] });
  });

  it("opens a document-viewer tab whose lazy content renders on the first visit", async () => {
    useQueueStore.getState().setItems([item]);
    const { result } = renderHook(() => useQueueNavigation());

    act(() => {
      result.current.openDocumentViewer(item);
    });

    const tab = useTabsStore.getState().tabs[0];
    expect(tab).toBeDefined();
    expect(tab.type).toBe("document-viewer");
    expect(tab.data).toEqual({ documentId: "doc-1", openedFrom: "queue" });

    // The tab's lazy content (wrapped in importWithRetry) must resolve to the
    // DocumentViewer module and render on this same first open.
    const Content = tab.content;
    render(
      <Suspense fallback={<div>Loading...</div>}>
        <Content />
      </Suspense>
    );
    expect(await screen.findByText("Queue Document Viewer")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });
});
