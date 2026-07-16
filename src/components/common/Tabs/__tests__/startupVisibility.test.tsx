import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TabContent, useIsActiveTab } from "../TabContent";
import type { Tab } from "../../../../stores/tabsStore";

function makeTab(id: string, content: Tab["content"]): Tab {
  return { id, title: id, icon: null, type: "dashboard", content, closable: true };
}

describe("tab startup visibility", () => {
  it("runs a boot effect for the active tab only", () => {
    const boot = vi.fn();
    function BootProbe() {
      const active = useIsActiveTab();
      useEffect(() => {
        if (active) boot();
      }, [active]);
      return null;
    }

    const tabs = [makeTab("dashboard", BootProbe), makeTab("queue", BootProbe)];
    const view = render(<TabContent tabs={tabs} activeTabId="dashboard" />);
    expect(boot).toHaveBeenCalledTimes(1);

    view.rerender(<TabContent tabs={tabs} activeTabId="queue" />);
    expect(boot).toHaveBeenCalledTimes(2);
  });
});
