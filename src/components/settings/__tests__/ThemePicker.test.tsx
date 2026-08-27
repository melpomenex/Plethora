/**
 * ThemePicker compact combobox tests (#3): compact default footprint, all
 * themes reachable, search/filter, live preview on hover/focus, explicit
 * commit, and accessibility semantics.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "../../../contexts/ThemeContext";
import { ThemePicker } from "../ThemePicker";

function renderPicker() {
  return render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>
  );
}

function openPicker() {
  const trigger = screen.getByRole("button", { name: /Biolume Abyss/ });
  fireEvent.click(trigger);
  return trigger;
}

beforeEach(() => {
  localStorage.clear();
});

describe("ThemePicker", () => {
  it("shows the active theme name + swatch in a compact control", () => {
    renderPicker();
    // The active theme appears in the summary row and in the collapsed trigger.
    expect(screen.getAllByText("Biolume Abyss").length).toBeGreaterThan(0);
  });

  it("opens a compact panel with every theme reachable (full catalog)", async () => {
    renderPicker();
    openPicker();

    // A built-in theme and a legacy theme are both reachable after the catalog
    // lazily loads.
    expect(await screen.findByText("Dracula")).toBeInTheDocument();
    expect(screen.getByText("Midnight")).toBeInTheDocument();
    // The panel reports the full count (176 built-in + any custom themes).
    expect(screen.getAllByText("177 themes").length).toBeGreaterThan(0);
  });

  it("filters the list by search text", async () => {
    renderPicker();
    openPicker();
    await screen.findByText("Dracula");

    const search = screen.getByLabelText("Search themes…");
    fireEvent.change(search, { target: { value: "dracula" } });

    expect(screen.getByText("Dracula")).toBeInTheDocument();
    expect(screen.queryByText("Midnight")).not.toBeInTheDocument();
    // Clearing search restores the full list.
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.getByText("Midnight")).toBeInTheDocument();
  });

  it("filters by light/dark variant", async () => {
    renderPicker();
    openPicker();
    await screen.findByText("Dracula");

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(screen.queryByText("Dracula")).not.toBeInTheDocument();
    expect(screen.getByText("Aurora Light")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByText("Dracula")).toBeInTheDocument();
    expect(screen.queryByText("Aurora Light")).not.toBeInTheDocument();
  });

  it("filters animated themes", async () => {
    renderPicker();
    openPicker();
    await screen.findByText("Dracula");

    fireEvent.click(screen.getByRole("button", { name: "Animated" }));
    expect(screen.getByText("Neon Grid")).toBeInTheDocument();
    expect(screen.getByText("Deep Ocean Glow")).toBeInTheDocument();
    expect(screen.queryByText("Dracula")).not.toBeInTheDocument();
  });

  it("live-previews on hover without committing, then commits on apply", async () => {
    renderPicker();
    openPicker();
    await screen.findByText("Nord");

    // Hovering a non-active theme applies it as a preview (DOM reflects it).
    fireEvent.mouseEnter(screen.getByText("Nord").closest("button") as HTMLElement);
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-id")).toBe("nord");
    });

    // A "Previewing" notice appears and the committed theme is not persisted yet.
    expect(screen.getByText(/Previewing: Nord/)).toBeInTheDocument();
    expect(localStorage.getItem("plethora-last-theme")).not.toBe("nord");

    // Clicking "Click to apply" commits the preview.
    fireEvent.click(screen.getByRole("button", { name: "Click to apply" }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-id")).toBe("nord");
      expect(localStorage.getItem("plethora-last-theme")).toBe("nord");
    });
    expect(screen.getAllByText("Nord").length).toBeGreaterThan(0);
  });

  it("commits a theme by clicking its row (mouse path)", async () => {
    renderPicker();
    openPicker();
    await screen.findByText("Dracula");

    fireEvent.click(screen.getByText("Dracula").closest("button") as HTMLElement);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-id")).toBe("dracula");
      expect(localStorage.getItem("plethora-last-theme")).toBe("dracula");
    });
  });

  it("supports keyboard selection (Enter) through the listbox", async () => {
    renderPicker();
    openPicker();
    await screen.findByText("Dracula");

    const search = screen.getByLabelText("Search themes…");
    // Arrow down once moves focus/preview to the first option, Enter commits.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(localStorage.getItem("plethora-last-theme")).not.toBeNull();
    });
    // The listbox closes after a selection.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clears a live preview on unmount without persisting it", async () => {
    function Harness() {
      const [show, setShow] = useState(true);
      return (
        <div>
          <button type="button" onClick={() => setShow(false)}>close picker</button>
          {show && <ThemePicker />}
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>
    );

    // Live-preview a non-active theme (the DOM reflects it).
    fireEvent.click(screen.getByRole("button", { name: /Biolume Abyss/ }));
    await screen.findByText("Nord");
    fireEvent.mouseEnter(screen.getByText("Nord").closest("button") as HTMLElement);
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-id")).toBe("nord");
    });
    // Not persisted as the selected theme while merely previewing.
    expect(localStorage.getItem("plethora-last-theme")).not.toBe("nord");

    // Unmounting the picker (keeping the provider mounted, as when switching
    // settings tabs) clears the stale preview and re-applies the committed
    // theme.
    fireEvent.click(screen.getByRole("button", { name: "close picker" }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-id")).toBe("biolume-abyss");
    });
    expect(localStorage.getItem("plethora-last-theme")).not.toBe("nord");
  });
});
