/**
 * Deferred tab mounting: a tab's content mounts the first time it is shown,
 * not the moment the tab exists.
 *
 * The counting invariants in `renderInvariants.test.tsx` cover how many
 * subtrees *render*; this file covers what actually gets *mounted*, and the
 * interaction with `useTabReactivation` — a first activation must run mount
 * work once, not mount work plus a spurious reactivation.
 */
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabContent, useIsActiveTab } from "../TabContent";
import { useTabReactivation } from "../../../../hooks/useTabReactivation";
import { useTabsStore, type Tab } from "../../../../stores/tabsStore";

function makeTab(id: string, content: Tab["content"]): Tab {
  return { id, title: id, icon: null, type: "dashboard", content, closable: true };
}

describe("deferred tab mounting", () => {
  afterEach(() => {
    useTabsStore.setState({ evictedTabIds: new Set() });
  });

  it("mounts only the active tab when a workspace of 12 tabs is restored", () => {
    const mounted = new Set<string>();

    const tabs = Array.from({ length: 12 }, (_unused, index) => {
      const id = `tab-${index}`;
      return makeTab(id, function MountProbe() {
        useEffect(() => {
          mounted.add(id);
        }, []);
        return <div>{id}</div>;
      });
    });

    render(<TabContent tabs={tabs} activeTabId="tab-0" />);

    expect([...mounted]).toEqual(["tab-0"]);
  });

  it("mounts one tab per pane when the workspace is split", () => {
    const mounted: string[] = [];

    const makeProbeTab = (id: string) =>
      makeTab(id, function MountProbe() {
        useEffect(() => {
          mounted.push(id);
        }, []);
        return <div>{id}</div>;
      });

    const paneOneTabs = [makeProbeTab("left-0"), makeProbeTab("left-1")];
    const paneTwoTabs = [makeProbeTab("right-0"), makeProbeTab("right-1")];

    // Two panes side by side is what SplitPaneContainer renders: one
    // TabContent per pane, each with its own active tab.
    render(
      <>
        <TabContent tabs={paneOneTabs} activeTabId="left-0" paneId="pane-1" />
        <TabContent tabs={paneTwoTabs} activeTabId="right-1" paneId="pane-2" />
      </>,
    );

    expect(mounted.sort()).toEqual(["left-0", "right-1"]);
  });

  it("mounts a never-shown tab on its first activation and keeps it after", () => {
    const mountCounts = new Map<string, number>();

    const makeProbeTab = (id: string) =>
      makeTab(id, function MountProbe() {
        useEffect(() => {
          mountCounts.set(id, (mountCounts.get(id) ?? 0) + 1);
        }, []);
        return <div data-testid={id}>{id}</div>;
      });

    const tabs = [makeProbeTab("a"), makeProbeTab("b")];
    const view = render(<TabContent tabs={tabs} activeTabId="a" />);

    expect(mountCounts.get("b")).toBeUndefined();

    view.rerender(<TabContent tabs={tabs} activeTabId="b" />);
    expect(mountCounts.get("b")).toBe(1);

    // Switching away and back must not remount it — that is what preserves
    // component state across switches.
    view.rerender(<TabContent tabs={tabs} activeTabId="a" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="b" />);
    expect(mountCounts.get("b")).toBe(1);
    expect(mountCounts.get("a")).toBe(1);
  });

  it("treats a first activation as a mount, not as a reactivation", () => {
    const mountWork = vi.fn();
    const reactivationWork = vi.fn();

    function ReactivationProbe() {
      const isActive = useIsActiveTab();
      useEffect(() => {
        mountWork();
      }, []);
      useTabReactivation(isActive, reactivationWork);
      return null;
    }

    const tabs = [makeTab("a", () => <div>a</div>), makeTab("b", ReactivationProbe)];
    const view = render(<TabContent tabs={tabs} activeTabId="a" />);

    expect(mountWork).not.toHaveBeenCalled();

    // First activation of "b": it mounts here, and `useTabReactivation`
    // ignores an initial active render, so no reactivation fires.
    view.rerender(<TabContent tabs={tabs} activeTabId="b" />);
    expect(mountWork).toHaveBeenCalledTimes(1);
    expect(reactivationWork).not.toHaveBeenCalled();

    // Away and back: now it is a genuine reactivation of a mounted tab.
    view.rerender(<TabContent tabs={tabs} activeTabId="a" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="b" />);
    expect(mountWork).toHaveBeenCalledTimes(1);
    expect(reactivationWork).toHaveBeenCalledTimes(1);
  });

  it("unmounts a tab the resident cap evicted, and remounts it on reactivation", () => {
    const mountCounts = new Map<string, number>();
    const makeProbeTab = (id: string) =>
      makeTab(id, function MountProbe() {
        useEffect(() => {
          mountCounts.set(id, (mountCounts.get(id) ?? 0) + 1);
        }, []);
        return <div data-testid={id}>{id}</div>;
      });

    const tabs = [makeProbeTab("kept"), makeProbeTab("evicted")];
    const view = render(<TabContent tabs={tabs} activeTabId="evicted" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="kept" />);
    expect(mountCounts.get("evicted")).toBe(1);

    // The store publishes the eviction; TabContent is what acts on it.
    act(() => {
      useTabsStore.setState({ evictedTabIds: new Set(["evicted"]) });
    });
    expect(screen.queryByTestId("evicted")).not.toBeInTheDocument();

    // Reactivating clears the eviction in the store, so the tab comes back —
    // freshly mounted, restoring from its own data rather than resuming.
    act(() => {
      useTabsStore.setState({ evictedTabIds: new Set() });
    });
    view.rerender(<TabContent tabs={tabs} activeTabId="evicted" />);
    expect(screen.getByTestId("evicted")).toBeInTheDocument();
    expect(mountCounts.get("evicted")).toBe(2);
    // The tab that was not evicted was never remounted.
    expect(mountCounts.get("kept")).toBe(1);
  });

  it("keeps an unmounted tab out of the accessibility tree and the DOM", () => {
    const tabs = [
      makeTab("a", () => <div data-testid="a-content">a</div>),
      makeTab("b", () => <div data-testid="b-content">b</div>),
    ];

    render(<TabContent tabs={tabs} activeTabId="a" />);

    expect(screen.getByTestId("a-content")).toBeInTheDocument();
    expect(screen.queryByTestId("b-content")).not.toBeInTheDocument();
  });
});
