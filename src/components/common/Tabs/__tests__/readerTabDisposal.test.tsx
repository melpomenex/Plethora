/**
 * Reader-tab disposal on close (task 5.6): closing one reader tab disposes
 * its resources (its unmount cleanup runs) and leaves sibling reader tabs
 * rendering and interactive.
 */
import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabContent } from "../TabContent";
import { useTabsStore } from "../../../../stores/tabsStore";
import { useSettingsStore } from "../../../../stores/settingsStore";

function resetStore() {
  useTabsStore.setState({
    tabs: [],
    rootPane: { id: "test-pane", type: "tabs", tabIds: [], activeTabId: null },
    closedTabs: [],
    activeTabHistory: [],
    forwardTabHistory: [],
    evictedTabIds: new Set<string>(),
  });
}

describe("reader tab disposal (task 5.6)", () => {
  it("closing one reader tab disposes it and leaves sibling readers rendering", () => {
    resetStore();
    const disposeA = vi.fn();

    function ReaderA() {
      useEffect(() => () => disposeA(), []);
      return <div>reader-a</div>;
    }
    function ReaderB() {
      return <div>reader-b</div>;
    }

    const idA = useTabsStore.getState().addTab({
      title: "A",
      icon: null,
      type: "document-viewer",
      content: ReaderA,
      closable: true,
      data: { documentId: "doc-a" },
    });
    useTabsStore.getState().addTab({
      title: "B",
      icon: null,
      type: "document-viewer",
      content: ReaderB,
      closable: true,
      data: { documentId: "doc-b" },
    });

    const { rerender } = render(
      <TabContent tabs={useTabsStore.getState().tabs} activeTabId={idA} />,
    );
    expect(screen.getByText("reader-a")).toBeTruthy();

    // Activate B (both readers now mounted, within the default cap of 2).
    const idB = useTabsStore.getState().tabs.find((t) => t.id !== idA)!.id;
    rerender(<TabContent tabs={useTabsStore.getState().tabs} activeTabId={idB} />);
    expect(screen.getByText("reader-b")).toBeTruthy();

    // Close A exactly as the UI does: the tab leaves the store, TabContent
    // unmounts it, and its disposal cleanup runs.
    useTabsStore.getState().closeTab(idA);
    rerender(<TabContent tabs={useTabsStore.getState().tabs} activeTabId={idB} />);

    expect(disposeA).toHaveBeenCalledTimes(1); // A's resources were disposed
    expect(screen.queryByText("reader-a")).toBeNull(); // A is gone
    expect(screen.getByText("reader-b")).toBeTruthy(); // B is still rendering
  });

  it("an evicted reader stays listed in the workspace while unmounted (task 8.5)", () => {
    resetStore();
    // Tighten the reader cap so the third activation evicts the LRU reader.
    const setReaderCap = (cap: number) =>
      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          general: { ...useSettingsStore.getState().settings.general, readerTabCap: cap },
        },
      });
    setReaderCap(1);

    function Reader({ id }: { id: string }) {
      return <div>reader-{id}</div>;
    }

    const ids = ["r1", "r2", "r3"].map((id) =>
      useTabsStore.getState().addTab({
        title: id,
        icon: null,
        type: "document-viewer",
        content: () => Reader({ id }),
        closable: true,
        data: { documentId: id },
      }),
    );
    // Activate through the store: setActiveTab is the only place the caps run.
    const activate = (id: string) => {
      const pane = useTabsStore.getState().findPaneContainingTab(id)!;
      useTabsStore.getState().setActiveTab(pane.id, id);
    };
    const { rerender } = render(
      <TabContent tabs={useTabsStore.getState().tabs} activeTabId={ids[0]} />,
    );
    activate(ids[1]);
    rerender(<TabContent tabs={useTabsStore.getState().tabs} activeTabId={ids[1]} />);
    activate(ids[2]);
    rerender(<TabContent tabs={useTabsStore.getState().tabs} activeTabId={ids[2]} />);

    // The LRU reader (r1) is evicted -> unmounted, but still in the workspace.
    expect(useTabsStore.getState().evictedTabIds.has(ids[0])).toBe(true);
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(ids);
    expect(screen.queryByText("reader-r1")).toBeNull();
    expect(screen.getByText("reader-r3")).toBeTruthy();

    setReaderCap(2);
  });
});
