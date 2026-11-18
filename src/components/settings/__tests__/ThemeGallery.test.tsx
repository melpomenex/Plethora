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
});
