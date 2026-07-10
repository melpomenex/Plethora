import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "../../../test/utils";
import { MobileNavigation } from "../MobileNavigation";
import { useTabsStore } from "../../../stores";
import { createTabPane } from "../../../stores/tabsStore";
import {
  requestOverlayBack,
  resetOverlayStackForTests,
} from "../../../lib/overlayStack";

const DummyTab = () => null;

describe("MobileNavigation", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
    });
    resetOverlayStackForTests();
  });

  it("opens the queue tab when Queue is tapped", () => {
    render(<MobileNavigation />);

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    const { tabs, rootPane } = useTabsStore.getState();
    const activeTabId = rootPane.type === "tabs" ? rootPane.activeTabId : null;
    const queueTab = tabs.find((tab) => tab.type === "queue");

    expect(queueTab).toBeTruthy();
    expect(activeTabId).toBe(queueTab?.id);
  });

  it("reuses an existing destination tab", () => {
    render(<MobileNavigation />);

    fireEvent.click(screen.getByRole("button", { name: "Queue" }));
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue" }));

    expect(
      useTabsStore.getState().tabs.filter((tab) => tab.type === "queue"),
    ).toHaveLength(1);
  });

  it("marks More as current and names the active secondary destination", () => {
    useTabsStore.getState().addTab({
      title: "Statistics",
      icon: "chart",
      type: "analytics",
      content: DummyTab,
      closable: true,
    });

    render(<MobileNavigation />);

    const more = screen.getByRole("button", {
      name: /More sections and actions:/,
    });
    expect(more).toHaveAttribute("aria-current", "page");
    expect(more).toHaveTextContent("Statistics");
  });

  it("closes the top overlay before navigation and restores focus", () => {
    render(<MobileNavigation />);
    const more = screen.getByRole("button", {
      name: "More sections and actions",
    });
    fireEvent.click(more);
    expect(screen.getByRole("dialog", { name: "Sections and actions" })).toBeInTheDocument();

    act(() => {
      expect(requestOverlayBack()).toBe(true);
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });
});
