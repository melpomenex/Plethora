/**
 * Split-pane isolation: work confined to one pane must stop at that pane.
 *
 * The workspace keeps a single `tabs` array shared by every pane, so any change
 * to any tab produced a new array and reconciled every pane's chrome. The pane
 * views are now memoized over a per-pane slice with a stable identity, which is
 * what this counts.
 *
 * `TabBar` is stubbed with a render counter: the tab *content* cannot show this
 * on its own, because `TabWrapper`'s memo already skips an unchanged active tab
 * whether or not the pane above it re-rendered.
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const barRenders = new Map<string, number>();

vi.mock("../TabBar", () => ({
  TabBar: ({ paneId }: { paneId?: string }) => {
    const key = paneId ?? "unknown";
    barRenders.set(key, (barRenders.get(key) ?? 0) + 1);
    return <div data-testid={`bar-${key}`} />;
  },
}));

import { SplitPaneContainer } from "../SplitPaneContainer";
import { createSplitPane, createTabPane, type Tab } from "../../../../stores/tabsStore";

const noop = () => {};

function makeTab(id: string, data?: Record<string, unknown>): Tab {
  return {
    id,
    title: id,
    icon: null,
    type: "dashboard",
    content: () => <div>{id}</div>,
    closable: true,
    data,
  };
}

describe("split pane isolation", () => {
  it("does not re-render an untouched pane when another pane's tab changes", () => {
    barRenders.clear();

    const leftTabs = [makeTab("left-a", { v: 1 }), makeTab("left-b")];
    const rightTabs = [makeTab("right-a"), makeTab("right-b")];
    const allTabs = [...leftTabs, ...rightTabs];

    const leftPane = createTabPane(["left-a", "left-b"], "left-a");
    const rightPane = createTabPane(["right-a", "right-b"], "right-a");
    const root = createSplitPane("horizontal", [leftPane, rightPane]);

    const props = {
      pane: root,
      onSetActiveTab: noop,
      onCloseTab: noop,
      onMoveTab: noop,
      onMoveTabToPane: noop,
      onSplitPane: noop,
      onMoveTabToSplit: noop,
      onSpawnTabInSplit: noop,
      onResizeSplit: noop,
      onCollapseSplit: noop,
      draggedTabId: null,
      draggedTabSourcePaneId: null,
      onDragStart: noop,
      onDragEnd: noop,
    } as unknown as React.ComponentProps<typeof SplitPaneContainer>;

    const view = render(<SplitPaneContainer {...props} tabs={allTabs} />);

    const rightBefore = barRenders.get(rightPane.id);
    const leftBefore = barRenders.get(leftPane.id);
    expect(rightBefore).toBe(1);
    expect(leftBefore).toBe(1);

    // A tab in the left pane gets new data: a new `tabs` array identity, which
    // every pane receives.
    const updatedTabs = allTabs.map((tab) =>
      tab.id === "left-a" ? { ...tab, data: { v: 2 } } : tab,
    );
    view.rerender(<SplitPaneContainer {...props} tabs={updatedTabs} />);

    expect(barRenders.get(leftPane.id)).toBe(2);
    expect(barRenders.get(rightPane.id)).toBe(rightBefore);
  });

  it("does not re-render an untouched pane when a tab is added to another pane", () => {
    barRenders.clear();

    const allTabs = [makeTab("left-a"), makeTab("right-a")];
    const leftPane = createTabPane(["left-a"], "left-a");
    const rightPane = createTabPane(["right-a"], "right-a");
    const root = createSplitPane("horizontal", [leftPane, rightPane]);

    const props = {
      pane: root,
      onSetActiveTab: noop,
      onCloseTab: noop,
      onMoveTab: noop,
      onMoveTabToPane: noop,
      onSplitPane: noop,
      onMoveTabToSplit: noop,
      onSpawnTabInSplit: noop,
      onResizeSplit: noop,
      onCollapseSplit: noop,
      draggedTabId: null,
      draggedTabSourcePaneId: null,
      onDragStart: noop,
      onDragEnd: noop,
    } as unknown as React.ComponentProps<typeof SplitPaneContainer>;

    const view = render(<SplitPaneContainer {...props} tabs={allTabs} />);
    const rightBefore = barRenders.get(rightPane.id);

    // Add a tab to the left pane only: new tabs array, new left pane node, the
    // right pane node unchanged (updatePaneInTree preserves sibling identity).
    const newTab = makeTab("left-b");
    const grownLeft = createTabPane(["left-a", "left-b"], "left-b");
    const grownRoot = { ...root, children: [{ ...grownLeft, id: leftPane.id }, rightPane] };

    view.rerender(
      <SplitPaneContainer {...props} pane={grownRoot} tabs={[...allTabs, newTab]} />,
    );

    expect(barRenders.get(rightPane.id)).toBe(rightBefore);
  });
});
