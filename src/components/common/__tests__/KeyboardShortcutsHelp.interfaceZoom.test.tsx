import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nativeSupport = vi.hoisted(() => ({ value: true }));

vi.mock("../../../lib/interfaceZoom/native", () => ({
  isDesktopInterfaceZoomSupported: () => nativeSupport.value,
}));

import KeyboardShortcutsHelp from "../KeyboardShortcutsHelp";
import { useShortcutStore } from "../KeyboardShortcuts";

beforeEach(() => {
  nativeSupport.value = true;
  useShortcutStore.getState().resetAll();
});

describe("KeyboardShortcutsHelp interface zoom rows", () => {
  it("shows the three interface-zoom bindings on desktop", () => {
    render(<KeyboardShortcutsHelp isOpen onClose={() => {}} />);

    expect(screen.getByText("Increase the whole interface scale")).toBeInTheDocument();
    expect(screen.getByText("Decrease the whole interface scale")).toBeInTheDocument();
    expect(screen.getByText("Reset interface zoom to 100%")).toBeInTheDocument();
  });

  it("hides them when native interface zoom is unsupported", () => {
    nativeSupport.value = false;
    render(<KeyboardShortcutsHelp isOpen onClose={() => {}} />);

    expect(screen.queryByText("Increase the whole interface scale")).not.toBeInTheDocument();
    expect(screen.queryByText("Decrease the whole interface scale")).not.toBeInTheDocument();
    expect(screen.queryByText("Reset interface zoom to 100%")).not.toBeInTheDocument();
    expect(screen.getByText("Toggle fullscreen mode")).toBeInTheDocument();
  });
});
