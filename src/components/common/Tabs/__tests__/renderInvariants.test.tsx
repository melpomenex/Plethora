/**
 * Render-shape invariants for the tab workspace.
 *
 * These assertions count renders; they never look at a clock. That is the
 * whole point. A timing benchmark cannot tell a 20% slowdown from "tab
 * switching became O(open tabs)" — both just widen a distribution — and its
 * tolerance has to stay loose enough to survive a shared CI runner. A counter
 * can be asserted exactly, on any machine, and a complexity-class regression
 * fails it immediately.
 *
 * The timing side of the same surface lives in the benchmark suites
 * (`src/stores/tabsWorkspace.bench.ts`, `../tabWorkspace.bench.tsx`).
 */
import { useEffect, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabContent, useIsActiveTab } from "../TabContent";
import type { Tab } from "../../../../stores/tabsStore";

/**
 * A workspace of `count` tabs whose content components each bump their own
 * render counter. `renderCounts` is keyed by tab id.
 */
function buildCountingWorkspace(count: number) {
  const renderCounts = new Map<string, number>();

  const tabs: Tab[] = Array.from({ length: count }, (_unused, index) => {
    const id = `tab-${index}`;
    renderCounts.set(id, 0);
    return {
      id,
      title: `Tab ${index}`,
      icon: null,
      type: "dashboard",
      content: function CountingTabContent() {
        renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
        return <div data-testid={`content-${id}`}>content {index}</div>;
      },
      closable: index > 0,
      data: { index },
    };
  });

  const snapshot = () => new Map(renderCounts);
  const changedSince = (before: Map<string, number>) =>
    [...renderCounts.entries()]
      .filter(([id, count]) => count !== before.get(id))
      .map(([id]) => id);

  return { tabs, renderCounts, snapshot, changedSince };
}

describe("tab workspace render invariants", () => {
  it("re-renders only the incoming tab when the active tab changes", () => {
    const { tabs, snapshot, changedSince } = buildCountingWorkspace(12);

    const view = render(<TabContent tabs={tabs} activeTabId="tab-0" />);
    const before = snapshot();

    view.rerender(<TabContent tabs={tabs} activeTabId="tab-5" />);

    // The outgoing tab is deliberately frozen at its last render and the other
    // ten are untouched, so exactly one subtree does work on a switch.
    expect(changedSince(before)).toEqual(["tab-5"]);
  });

  it("does not scale switch cost with the number of open tabs", () => {
    const switchedSubtrees = (tabCount: number) => {
      const { tabs, snapshot, changedSince } = buildCountingWorkspace(tabCount);
      const view = render(<TabContent tabs={tabs} activeTabId="tab-0" />);
      const before = snapshot();
      view.rerender(<TabContent tabs={tabs} activeTabId="tab-1" />);
      const changed = changedSince(before).length;
      view.unmount();
      return changed;
    };

    expect(switchedSubtrees(12)).toBe(switchedSubtrees(4));
  });

  it("re-renders only the tab whose data changed", () => {
    const { tabs, snapshot, changedSince } = buildCountingWorkspace(12);

    const view = render(<TabContent tabs={tabs} activeTabId="tab-0" />);
    const before = snapshot();

    const updated = tabs.map((tab) =>
      tab.id === "tab-0" ? { ...tab, data: { index: 0, revision: 2 } } : tab,
    );
    view.rerender(<TabContent tabs={updated} activeTabId="tab-0" />);

    expect(changedSince(before)).toEqual(["tab-0"]);
  });

  // The two contracts below already hold and are pinned here as well as in
  // TabContent.test.tsx / startupVisibility.test.tsx, so that a change chasing
  // the render counters above cannot satisfy them by throwing state away or by
  // waking every tab's boot work.

  it("preserves tab state across a switch away and back", async () => {
    const user = userEvent.setup();

    function StatefulTab() {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="stateful-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }

    const tabs: Tab[] = [
      { id: "a", title: "A", icon: null, type: "documents", content: StatefulTab, closable: true },
      {
        id: "b",
        title: "B",
        icon: null,
        type: "queue",
        content: function StaticTab() {
          return <div>static</div>;
        },
        closable: true,
      },
    ];

    const view = render(<TabContent tabs={tabs} activeTabId="a" />);
    await user.type(screen.getByLabelText("stateful-input"), "keep me");

    view.rerender(<TabContent tabs={tabs} activeTabId="b" />);
    view.rerender(<TabContent tabs={tabs} activeTabId="a" />);

    expect(screen.getByLabelText("stateful-input")).toHaveValue("keep me");
  });

  it("runs an active-gated boot effect for exactly one tab", () => {
    const boot = vi.fn();

    function BootProbe() {
      const active = useIsActiveTab();
      useEffect(() => {
        if (active) boot();
      }, [active]);
      return null;
    }

    const tabs: Tab[] = Array.from({ length: 12 }, (_unused, index) => ({
      id: `tab-${index}`,
      title: `Tab ${index}`,
      icon: null,
      type: "dashboard",
      content: BootProbe,
      closable: index > 0,
    }));

    render(<TabContent tabs={tabs} activeTabId="tab-0" />);

    expect(boot).toHaveBeenCalledTimes(1);
  });
});
