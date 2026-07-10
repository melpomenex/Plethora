import { useState } from "react";
import { act, fireEvent, render, screen } from "../../test/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", () => ({
  getPlatform: () => "mac",
  isNativeMobile: () => false,
  isNativePhone: () => false,
  isTauri: () => false,
  nativePlatform: () => null,
}));

import {
  PresentationProvider,
  usePresentation,
} from "../PresentationContext";
import { createTabPane, useTabsStore } from "../../stores/tabsStore";

function Probe() {
  const presentation = usePresentation();
  const [draft, setDraft] = useState("");
  return (
    <>
      <output aria-label="presentation">{presentation.mode}</output>
      <input
        aria-label="draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  );
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

describe("PresentationProvider", () => {
  beforeEach(() => {
    setViewport(1280, 800);
    useTabsStore.setState({
      tabs: [],
      rootPane: createTabPane([], null),
      closedTabs: [],
      activeTabHistory: [],
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reacts to resize and exposes root presentation attributes", () => {
    const { unmount } = render(
      <PresentationProvider>
        <Probe />
      </PresentationProvider>,
    );

    expect(screen.getByLabelText("presentation")).toHaveTextContent("desktop");
    expect(document.documentElement.dataset.presentation).toBe("desktop");

    setViewport(390, 844);
    act(() => window.dispatchEvent(new Event("resize")));

    expect(screen.getByLabelText("presentation")).toHaveTextContent("phone");
    expect(document.documentElement.dataset.presentation).toBe("phone");
    expect(document.documentElement.dataset.pointer).toBe("fine");
    expect(document.documentElement.dataset.reducedMotion).toBe("false");

    unmount();
    expect(document.documentElement.dataset.presentation).toBeUndefined();
  });

  it("preserves local workflow state across presentation changes", () => {
    const tabs = useTabsStore.getState();
    const firstId = tabs.addTab({
      title: "First",
      icon: null,
      type: "dashboard",
      content: () => null,
      closable: false,
    });
    const activeId = useTabsStore.getState().addTab({
      title: "Active",
      icon: null,
      type: "documents",
      content: () => null,
      closable: true,
    });

    render(
      <PresentationProvider>
        <Probe />
      </PresentationProvider>,
    );

    fireEvent.change(screen.getByLabelText("draft"), {
      target: { value: "unsaved note" },
    });
    setViewport(390, 844);
    act(() => window.dispatchEvent(new Event("orientationchange")));

    expect(screen.getByLabelText("draft")).toHaveValue("unsaved note");
    expect(screen.getByLabelText("presentation")).toHaveTextContent("phone");
    const pane = useTabsStore.getState().rootPane;
    expect(pane.type).toBe("tabs");
    if (pane.type === "tabs") {
      expect(pane.activeTabId).toBe(activeId);
      expect(pane.tabIds).toEqual([firstId, activeId]);
    }
  });

  it("removes the shared window listeners on cleanup", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <PresentationProvider>
        <Probe />
      </PresentationProvider>,
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith(
      "orientationchange",
      expect.any(Function),
    );
  });
});
