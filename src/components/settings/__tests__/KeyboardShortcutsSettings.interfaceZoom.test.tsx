import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nativeSupport = vi.hoisted(() => ({ value: true }));

vi.mock("../../../lib/interfaceZoom/native", () => ({
  isDesktopInterfaceZoomSupported: () => nativeSupport.value,
}));

import { KeyboardShortcutSettings } from "../KeyboardShortcutsSettings";
import { useShortcutStore } from "../../common/KeyboardShortcuts";

beforeEach(() => {
  nativeSupport.value = true;
  useShortcutStore.getState().resetAll();
});

describe("KeyboardShortcutSettings interface zoom rows", () => {
  it("renders all three interface-zoom bindings on desktop", () => {
    render(<KeyboardShortcutSettings onChange={() => {}} />);

    expect(screen.getByText("Zoom Interface In")).toBeInTheDocument();
    expect(screen.getByText("Zoom Interface Out")).toBeInTheDocument();
    expect(screen.getByText("Reset Interface Zoom")).toBeInTheDocument();
    expect(screen.getByText("Increase the whole interface scale")).toBeInTheDocument();
    expect(screen.getByText("Decrease the whole interface scale")).toBeInTheDocument();
  });

  it("omits them when native interface zoom is unsupported", () => {
    nativeSupport.value = false;
    render(<KeyboardShortcutSettings onChange={() => {}} />);

    expect(screen.queryByText("Zoom Interface In")).not.toBeInTheDocument();
    expect(screen.queryByText("Zoom Interface Out")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset Interface Zoom")).not.toBeInTheDocument();
    // Other View shortcuts remain advertised.
    expect(screen.getByText("Toggle Fullscreen")).toBeInTheDocument();
  });
});
