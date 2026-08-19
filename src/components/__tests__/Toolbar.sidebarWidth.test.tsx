import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { Toolbar } from "../Toolbar";
import { useTabsStore, createTabPane, useSettingsStore } from "../../stores";
import { defaultSettings } from "../../stores/settingsStore";

function resetTabsStore() {
  useTabsStore.setState({
    tabs: [],
    rootPane: createTabPane([], null),
    closedTabs: [],
    activeTabHistory: [],
    forwardTabHistory: [],
  });
}

function resetSettingsStore() {
  useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
}

describe("Toolbar sidebar width wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTabsStore();
    resetSettingsStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("feeds the persisted sidebar width into --toolbar-expanded-w on vertical rails", () => {
    const { container } = render(<Toolbar position="left" />);
    const rail = container.querySelector(".toolbar-rail") as HTMLElement;
    expect(rail).toBeInTheDocument();
    // Default (11.5rem = 184px) matches current Plethora behavior.
    expect(rail.style.getPropertyValue("--toolbar-expanded-w")).toBe("184px");
  });

  it("updates the CSS variable immediately when the setting changes", () => {
    const { container, rerender } = render(<Toolbar position="right" />);
    const rail = container.querySelector(".toolbar-rail") as HTMLElement;
    expect(rail.style.getPropertyValue("--toolbar-expanded-w")).toBe("184px");

    act(() => {
      useSettingsStore.getState().updateSettingsCategory("interface", { sidebarWidth: 280 });
    });
    rerender(<Toolbar position="right" />);

    expect(rail.style.getPropertyValue("--toolbar-expanded-w")).toBe("280px");
  });

  it("does not apply a width variable to the top strip (height-driven layout)", () => {
    const { container } = render(<Toolbar position="top" />);
    const rail = container.querySelector(".toolbar-rail") as HTMLElement;
    expect(rail.style.getPropertyValue("--toolbar-expanded-w")).toBe("");
  });
});
