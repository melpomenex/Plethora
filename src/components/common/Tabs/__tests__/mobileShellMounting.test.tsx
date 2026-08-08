/**
 * The mobile shell flattens the pane tree to a single pane, but it renders that
 * pane through the same `TabContent` as the desktop split-pane path
 * (`Tabs.tsx`), so it inherits deferred mounting for free. This test pins that:
 * a phone restoring a workspace of tabs mounts one, not all of them.
 */
import { useEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "../Tabs";
import { useTabsStore, createTabPane, type Tab } from "../../../../stores/tabsStore";

vi.mock("../../../../hooks/useMobileShell", () => ({
  useMobileShell: () => true,
}));

describe("mobile shell tab mounting", () => {
  it("mounts only the active tab of the flattened pane", () => {
    const mounted: string[] = [];

    const tabs: Tab[] = Array.from({ length: 8 }, (_unused, index) => {
      const id = `mobile-tab-${index}`;
      return {
        id,
        title: id,
        icon: null,
        type: "dashboard",
        content: function MountProbe() {
          useEffect(() => {
            mounted.push(id);
          }, []);
          return <div>{id}</div>;
        },
        closable: index > 0,
      };
    });

    useTabsStore.setState({
      tabs,
      rootPane: createTabPane(
        tabs.map((tab) => tab.id),
        tabs[2].id,
      ),
      closedTabs: [],
      activeTabHistory: [tabs[2].id],
      forwardTabHistory: [],
    });

    render(<Tabs />);

    expect(mounted).toEqual(["mobile-tab-2"]);
  });
});
