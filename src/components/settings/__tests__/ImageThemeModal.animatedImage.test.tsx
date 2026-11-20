import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { milkyMatchaTheme } from "../../../themes/fallback";

const mocks = vi.hoisted(() => ({
  prepared: null as unknown,
  theme: null as unknown,
  prepare: vi.fn(),
  cancelPreparation: vi.fn(),
  beginPreview: vi.fn(() => 73),
  updatePreview: vi.fn(),
  cancelPreview: vi.fn(),
  commitPreview: vi.fn(),
  close: vi.fn(),
  saved: vi.fn(),
}));

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: mocks.theme,
    themes: [mocks.theme],
    addCustomTheme: vi.fn(),
    setTheme: vi.fn(),
    previewCustomTheme: vi.fn(),
    beginAnimatedImagePreview: mocks.beginPreview,
    updateAnimatedImagePreview: mocks.updatePreview,
    cancelAnimatedImagePreview: mocks.cancelPreview,
    commitAnimatedImagePreview: mocks.commitPreview,
  }),
}));

vi.mock("../../../themes/animatedImage/prepareAnimatedImage", () => ({
  cancelAnimatedImagePreparation: mocks.cancelPreparation,
  prepareAnimatedImageFile: mocks.prepare,
}));

vi.mock("../../../themes/imageStorage", () => ({
  prepareBackdropImage: vi.fn(),
  saveBackdropImage: vi.fn(async () => undefined),
}));

import { ImageThemeModal } from "../ImageThemeModal";

function preparedAnimatedImage() {
  const still = new Blob(["still"], { type: "image/png" });
  const mediaId = "anim-12345678-1234-4234-8234-123456789abc";
  return {
    mediaId,
    tier: "mobile" as const,
    outcome: "animated" as const,
    poster: still,
    thumbnail: still,
    thumbnailDataUrl: "data:image/png;base64,AA==",
    width: 2,
    height: 1,
    sourceWidth: 2,
    sourceHeight: 1,
    paletteSamples: [{
      pixels: new Uint8ClampedArray([220, 35, 50, 255, 30, 85, 200, 255]),
      width: 2,
      height: 1,
      weightMs: 100,
    }],
    pack: {
      version: 1 as const,
      mediaId,
      sourceFormat: "gif" as const,
      sourceWidth: 2,
      sourceHeight: 1,
      width: 2,
      height: 1,
      durationMs: 100,
      plays: "infinite" as const,
      frames: [
        { startMs: 0, durationMs: 50, still, width: 2, height: 1 },
        { startMs: 50, durationMs: 50, still, width: 2, height: 1 },
      ],
      byteLength: still.size * 2,
      droppedTransitions: false,
    },
  };
}

describe("ImageThemeModal animated-image flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.theme = milkyMatchaTheme;
    mocks.prepared = preparedAnimatedImage();
    mocks.prepare.mockResolvedValue(mocks.prepared);
    mocks.beginPreview.mockReturnValue(73);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:prepared-poster"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("accepts a GIF drop and shows the animated preview controls", async () => {
    render(<ImageThemeModal onClose={mocks.close} onSaved={mocks.saved} />);
    const dropzone = document.body.querySelector(".border-dashed");
    expect(dropzone).not.toBeNull();
    const file = new File(["GIF89a"], "dropped.gif", { type: "image/gif" });
    const dataTransfer = { files: [file], items: [], types: ["Files"] };

    fireEvent.dragOver(dropzone!, { dataTransfer });
    expect(dropzone).toHaveClass("bg-primary/10");
    fireEvent.drop(dropzone!, { dataTransfer });

    const playToggle = await screen.findByRole("checkbox", { name: "Play animation" });
    expect(playToggle).toBeChecked();
    expect(mocks.prepare).toHaveBeenCalledWith(file, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.beginPreview).toHaveBeenCalledOnce();
  });

  it("stages GIF preview, updates styles, and keeps the draft available for save retry", async () => {
    mocks.commitPreview.mockRejectedValueOnce(new Error("Storage is temporarily unavailable"))
      .mockResolvedValueOnce(undefined);
    render(<ImageThemeModal onClose={mocks.close} onSaved={mocks.saved} />);

    const input = document.getElementById("image-theme-file-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["GIF89a"], "motion.gif", { type: "image/gif" })] },
    });

    const playToggle = await screen.findByRole("checkbox", { name: "Play animation" });
    await waitFor(() => expect(mocks.beginPreview).toHaveBeenCalledOnce());
    expect(mocks.prepare).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByAltText("Backdrop preview")).toHaveAttribute("src", "blob:prepared-poster");

    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(mocks.updatePreview).toHaveBeenCalledWith(73, expect.objectContaining({
      effects: expect.objectContaining({ imageAnimation: expect.objectContaining({ enabled: true }) }),
    })));
    expect(playToggle).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Save & Apply Theme" }));
    expect(await screen.findByText("Storage is temporarily unavailable")).toBeInTheDocument();
    expect(mocks.commitPreview).toHaveBeenCalledTimes(1);
    expect(mocks.close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save & Apply Theme" }));
    await waitFor(() => expect(mocks.commitPreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(mocks.saved).toHaveBeenCalledOnce();
  });
});
