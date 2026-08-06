import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueueTab } from "../QueueTab";
import { useTabsStore } from "../../../stores/tabsStore";
import type { QueueItem } from "../../../types/queue";

const mockQueueItems: QueueItem[] = [
  {
    id: "item-1",
    documentId: "doc-1",
    documentTitle: "Doc One",
    itemType: "document",
    priority: 5,
    estimatedTime: 10,
    tags: [],
    progress: 0,
  },
  {
    id: "item-2",
    documentId: "doc-2",
    documentTitle: "Doc Two",
    itemType: "document",
    priority: 6,
    estimatedTime: 5,
    tags: [],
    progress: 0,
  },
];

vi.mock("../TabRegistry", () => ({
  ReviewTab: () => <div>Review Tab</div>,
  DocumentViewer: () => <div>Document Viewer</div>,
}));

vi.mock("../../pages/QueueScrollPage", () => ({
  QueueScrollPage: () => <div>Queue Scroll Page</div>,
}));

vi.mock("../../review/ReviewQueueView", () => ({
  ReviewQueueView: ({ onOpenScrollMode }: { onOpenScrollMode?: (options?: any) => void }) => (
    <div>
      <button onClick={() => onOpenScrollMode?.({ items: mockQueueItems, mode: "queue-list" })}>
        Open Queue Scroll
      </button>
      <button onClick={() => onOpenScrollMode?.({ mode: "optimal" })}>
        Open Optimal Scroll
      </button>
    </div>
  ),
}));

vi.mock("../../mobile/MobileQueueView", () => ({
  MobileQueueView: () => <div>Mobile Queue View</div>,
}));

vi.mock("../../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
}));

vi.mock("../common/Tabs", () => ({
  usePaneId: () => "pane-1",
}));

describe("QueueTab", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [],
    });
  });

  it("passes queue-list mode and items to tabsStore when opening scroll mode in queue order", () => {
    render(<QueueTab />);
    fireEvent.click(screen.getByText("Open Queue Scroll"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0].type).toBe("queue-scroll");
    expect(tabs[0].data).toEqual({
      customQueueItems: mockQueueItems,
      queueScrollMode: "queue-list",
    });
  });

  it("passes optimal mode to tabsStore when starting optimal session", () => {
    render(<QueueTab />);
    fireEvent.click(screen.getByText("Open Optimal Scroll"));

    const tabs = useTabsStore.getState().tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0].type).toBe("queue-scroll");
    expect(tabs[0].data).toEqual({
      customQueueItems: undefined,
      queueScrollMode: "optimal",
    });
  });
});
