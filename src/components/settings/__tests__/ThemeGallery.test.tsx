import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    getPlatform: () => "android",
    isNativeMobile: () => true,
    isNativePhone: () => true,
    isTauri: () => true,
    nativePlatform: () => "android",
  };
});

import { PresentationProvider } from "../../../contexts/PresentationContext";
import { ThemeProvider } from "../../../contexts/ThemeContext";
import { highestOverlayPriority } from "../../../lib/overlayStack";
import { ThemeGallery } from "../ThemeGallery";

describe("ThemeGallery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders inside the shared adaptive dialog sheet portaled to document.body on phone presentation", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });

    const onClose = vi.fn();
    render(
      <PresentationProvider>
        <ThemeProvider>
          <ThemeGallery onClose={onClose} />
        </ThemeProvider>
      </PresentationProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: /Theme Gallery/i });
    expect(dialog).toHaveClass("adaptive-dialog-sheet");
    expect(dialog.closest(".adaptive-dialog-layer")?.parentElement).toBe(document.body);
    expect(highestOverlayPriority()).toBeGreaterThan(0);

    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton.closest(".adaptive-dialog-footer")).not.toBeNull();
    fireEvent.click(doneButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses ResponsiveDialogSheet instead of an ad-hoc fixed inset-0 overlay", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../ThemeGallery.tsx"),
      "utf8",
    );
    expect(source).toContain('from "../adaptive/ResponsiveDialogSheet"');
    expect(source).toContain("<ResponsiveDialogSheet");

    const classNameValues = Array.from(source.matchAll(/className="([^"]*)"/g), (m) => m[1]);
    const offenders = classNameValues.filter(
      (value) => (value.includes("fixed") && value.includes("inset-0")) || /\bz-(\[)?\d/.test(value),
    );
    expect(offenders).toEqual([]);
  });

  it("fuzzy searches themes by substring, subsequence, typo, and multi-token query", async () => {
    const onClose = vi.fn();
    render(
      <PresentationProvider>
        <ThemeProvider>
          <ThemeGallery onClose={onClose} />
        </ThemeProvider>
      </PresentationProvider>,
    );

    // Wait for lazy-loaded built-in theme catalog
    await screen.findAllByText("Deep Ocean Glow");

    const searchInput = screen.getByRole("textbox", { name: /Search themes/i });

    // Subsequence match: "dog" -> Deep Ocean Glow
    fireEvent.change(searchInput, { target: { value: "dog" } });
    expect(screen.getByText("Deep Ocean Glow")).toBeInTheDocument();
    expect(screen.queryByText("Light Themes")).not.toBeInTheDocument();

    // Typo tolerance: "macha" -> Milky Matcha
    fireEvent.change(searchInput, { target: { value: "macha" } });
    expect(screen.getByText("Milky Matcha")).toBeInTheDocument();
    expect(screen.queryByText("Deep Ocean Glow")).not.toBeInTheDocument();

    // Multi-token match: "dark neon" -> Deep Sea Neon (dark variant + neon)
    fireEvent.change(searchInput, { target: { value: "dark neon" } });
    expect(screen.getByText("Deep Sea Neon")).toBeInTheDocument();

    // First Escape clears the search without closing the gallery
    fireEvent.keyDown(searchInput, { key: "Escape" });
    expect(searchInput).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Light Themes")).toBeInTheDocument();
  });

  it("shows an empty state and clear action when no themes match", async () => {
    render(
      <PresentationProvider>
        <ThemeProvider>
          <ThemeGallery onClose={vi.fn()} />
        </ThemeProvider>
      </PresentationProvider>,
    );

    await screen.findAllByText("Deep Ocean Glow");

    const searchInput = screen.getByRole("textbox", { name: /Search themes/i });
    fireEvent.change(searchInput, { target: { value: "zzzznotatheme" } });

    expect(screen.getByText("0 themes")).toBeInTheDocument();
    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    expect(searchInput).toHaveValue("");
    expect(screen.getByText("Light Themes")).toBeInTheDocument();
  });
});
