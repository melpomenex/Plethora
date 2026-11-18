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
import { ImageThemeModal } from "../ImageThemeModal";

describe("ImageThemeModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders inside the shared adaptive dialog sheet on phone presentation", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });

    const onClose = vi.fn();
    render(
      <PresentationProvider>
        <ThemeProvider>
          <ImageThemeModal onClose={onClose} />
        </ThemeProvider>
      </PresentationProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: /Create Theme from Image/i });
    expect(dialog).toHaveClass("adaptive-dialog-sheet");
    expect(dialog.closest(".adaptive-dialog-layer")?.parentElement).toBe(document.body);

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton.closest(".adaptive-dialog-footer")).not.toBeNull();
    fireEvent.click(cancelButton);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses ResponsiveDialogSheet instead of an ad-hoc fixed overlay", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../ImageThemeModal.tsx"),
      "utf8",
    );
    expect(source).toContain('from "../adaptive/ResponsiveDialogSheet"');
    expect(source).toContain("<ResponsiveDialogSheet");

    const classNameValues = Array.from(source.matchAll(/className="([^"]*)"/g), (m) => m[1]);
    const offenders = classNameValues.filter(
      (value) => value.includes("fixed") && value.includes("inset-0"),
    );
    expect(offenders).toEqual([]);
  });
});
