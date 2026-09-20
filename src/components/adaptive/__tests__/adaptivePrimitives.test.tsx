import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
} from "../../../test/utils";

vi.mock("../../../lib/tauri", () => ({
  getPlatform: () => "mac",
  isNativeMobile: () => false,
  isNativePhone: () => false,
  isTauri: () => false,
  nativePlatform: () => null,
}));

import { PresentationProvider } from "../../../contexts/PresentationContext";
import { AdaptiveContentHeader } from "../AdaptiveContentHeader";
import { ResponsiveDialogSheet } from "../ResponsiveDialogSheet";
import { AdaptiveInspector } from "../AdaptiveInspector";
import { SafeScrollContainer, StickyActionBar } from "../SafeScrollContainer";

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

describe("adaptive interface primitives", () => {
  beforeEach(() => {
    setViewport(390, 844);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("prioritizes header content and moves lower-priority actions into overflow", () => {
    const action = vi.fn();
    render(
      <AdaptiveContentHeader
        title="Documents"
        description="Three items"
        status={<span>Synced</span>}
        primaryAction={<button type="button">Import</button>}
        secondaryActions={<button type="button">Filter</button>}
        overflowActions={[
          { id: "export", label: "Export", onSelect: action },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));

    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("uses a sheet on phones, traps focus, closes on Escape, and restores focus", () => {
    function DialogHarness() {
      const [open, setOpen] = useState(false);
      return (
        <PresentationProvider>
          <button type="button" onClick={() => setOpen(true)}>
            Open dialog
          </button>
          <ResponsiveDialogSheet
            open={open}
            onClose={() => setOpen(false)}
            title="Import article"
            footer={<button type="button">Import</button>}
          >
            <input aria-label="Article URL" />
          </ResponsiveDialogSheet>
        </PresentationProvider>
      );
    }

    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Import article" });
    expect(dialog).toHaveClass("adaptive-dialog-sheet");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    // The dialog's Escape listener lives on document (useDialogFocus); a
    // keydown fired at window never reaches it, so dispatch from the focused
    // element like a real keystroke would.
    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps inspector child state mounted while the drawer is closed", () => {
    function InspectorHarness() {
      const [open, setOpen] = useState(true);
      return (
        <PresentationProvider>
          <button type="button" onClick={() => setOpen((value) => !value)}>
            Toggle inspector
          </button>
          <AdaptiveInspector open={open} onClose={() => setOpen(false)} title="Inspector">
            <input aria-label="Inspector draft" />
          </AdaptiveInspector>
        </PresentationProvider>
      );
    }

    render(<InspectorHarness />);
    fireEvent.change(screen.getByLabelText("Inspector draft"), {
      target: { value: "keep me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Toggle inspector" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle inspector" }));

    expect(screen.getByLabelText("Inspector draft")).toHaveValue("keep me");
  });

  it("provides safe scroll and sticky action structure", () => {
    render(
      <SafeScrollContainer data-testid="scroll">
        <div>Content</div>
        <StickyActionBar>
          <button type="button">Save</button>
        </StickyActionBar>
      </SafeScrollContainer>,
    );

    expect(screen.getByTestId("scroll")).toHaveClass("adaptive-safe-scroll");
    expect(screen.getByRole("button", { name: "Save" }).parentElement).toHaveClass(
      "adaptive-sticky-actions",
    );
  });
});
