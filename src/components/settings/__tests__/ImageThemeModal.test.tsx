import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import * as imageStorage from "../../../themes/imageStorage";
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

  it("does not flicker between preview and committed theme while open", async () => {
    vi.spyOn(imageStorage, "prepareBackdropImage").mockResolvedValue({
      imageId: "img-test-1",
      dataUrl: "data:image/png;base64,AAAA",
      thumbnailDataUrl: "data:image/png;base64,AAAA",
      width: 2,
      height: 1,
      samplePixels: new Uint8ClampedArray([200, 100, 50, 255, 60, 120, 180, 255]),
      sampleWidth: 2,
      sampleHeight: 1,
    });
    vi.spyOn(imageStorage, "saveBackdropImage").mockResolvedValue(undefined);

    const setAttrSpy = vi.spyOn(document.documentElement, "setAttribute");
    const removeAttrSpy = vi.spyOn(document.documentElement, "removeAttribute");

    render(
      <PresentationProvider>
        <ThemeProvider>
          <ImageThemeModal onClose={vi.fn()} />
        </ThemeProvider>
      </PresentationProvider>,
    );

    const fileInput = document.getElementById("image-theme-file-input") as HTMLInputElement;
    const file = new File(["dummy"], "wallpaper.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-image-backdrop")).toBe("true");
    });

    // Clear spy counts after initial preview application, then flush microtasks/timers
    // to ensure no oscillation loop occurs while the modal remains open.
    setAttrSpy.mockClear();
    removeAttrSpy.mockClear();
    await new Promise((r) => setTimeout(r, 50));

    const backdropRemovesWhileOpen = removeAttrSpy.mock.calls.filter(
      ([attr]) => attr === "data-theme-image-backdrop",
    );
    const backdropSetsWhileOpen = setAttrSpy.mock.calls.filter(
      ([attr]) => attr === "data-theme-image-backdrop",
    );
    expect(backdropRemovesWhileOpen).toHaveLength(0);
    expect(backdropSetsWhileOpen).toHaveLength(0);

    // Reverting happens cleanly on cancel.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme-image-backdrop")).toBeNull();
    });
  });
});
