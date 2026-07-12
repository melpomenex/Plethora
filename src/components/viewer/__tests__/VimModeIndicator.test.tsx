import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useVimModeStore } from "../../../stores/vimModeStore";
import { VimModeIndicator } from "../VimModeIndicator";

describe("Reading Rail", () => {
  beforeEach(() => { localStorage.removeItem("vim-reading-hint-seen"); useVimModeStore.getState().activate("doc"); });
  afterEach(() => { cleanup(); useVimModeStore.getState().deactivate(); });

  it("announces normal mode, location, and pending input", () => {
    useVimModeStore.getState().setLocationLabel("p. 12"); useVimModeStore.getState().setPendingSequence("g");
    render(<VimModeIndicator />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("NORMAL")).toBeInTheDocument(); expect(screen.getByText("p. 12")).toBeInTheDocument(); expect(screen.getByText("g…")).toBeInTheDocument();
  });

  it("reveals accessible actions and keyboard/touch color controls in visual mode", () => {
    useVimModeStore.getState().setMode("visual"); render(<VimModeIndicator />);
    expect(screen.getByRole("button", { name: /Extract/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Highlight/ }));
    expect(screen.getByRole("group", { name: "Highlight color" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Highlight purple" })).toBeVisible();
  });

  it("shows mode-sensitive help and retry feedback", () => {
    useVimModeStore.getState().setMode("visual"); useVimModeStore.getState().setFeedback({ kind: "error", message: "Offline — retry" });
    render(<VimModeIndicator />); fireEvent(window, new CustomEvent("vim-reading-help"));
    expect(screen.getByRole("dialog", { name: "Vim reading commands" })).toHaveTextContent(/Extend with motions/);
    expect(screen.getByText("Offline — retry")).toBeInTheDocument();
  });
});
