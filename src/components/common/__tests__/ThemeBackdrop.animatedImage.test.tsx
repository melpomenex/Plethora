import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeBackdrop } from "../ThemeBackdrop";

const { mockTheme, mockLoadPoster, mockLoadPack, mockAnimationsEnabled } = vi.hoisted(() => ({
  mockTheme: { current: null as unknown },
  mockLoadPoster: vi.fn(),
  mockLoadPack: vi.fn(),
  mockAnimationsEnabled: { value: true },
}));

vi.mock("../../../contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: mockTheme.current,
    appliedTheme: mockTheme.current,
    themes: [],
    previewThemeId: null,
    animatedImagePreview: null,
  }),
}));

vi.mock("../../../contexts/BatteryContext", () => ({
  useBattery: () => ({ onBattery: false, battery: null }),
}));

vi.mock("../../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ isMobileShell: false, isEinkMode: false, reducedMotion: false }),
}));

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (value: unknown) => unknown) => selector({
    settings: { interface: { animationsEnabled: mockAnimationsEnabled.value, reducedMotionForce: false, animationFrequency: 1, animationBrightness: 10 } },
  }),
}));

vi.mock("../../../lib/tauri", () => ({ isNativeMobile: () => false }));
vi.mock("../../../themes/imageStorage", () => ({ loadBackdropImage: vi.fn() }));
vi.mock("../../../themes/animatedImage/storage", () => ({
  animatedImagePosterKey: (mediaId: string) => `media:v1:${mediaId}:poster`,
  loadAnimatedImagePoster: mockLoadPoster,
  loadAnimatedImagePack: mockLoadPack,
}));

const MEDIA_ID = "anim-00000000-0000-4000-8000-000000000001";
const POSTER_KEY = `media:v1:${MEDIA_ID}:poster`;

function imageTheme(id = "saved-media") {
  return {
    id,
    variant: "dark",
    colors: { background: "#101010" },
    effects: {
      backgroundImage: {
        imageId: POSTER_KEY,
        thumbnailDataUrl: "data:image/png;base64,thumb",
      },
      imageAnimation: { version: 1, mediaId: MEDIA_ID, sourceFormat: "gif", enabled: true },
    },
  };
}

beforeEach(() => {
  mockTheme.current = imageTheme();
  mockLoadPoster.mockReset();
  mockLoadPack.mockReset();
  mockLoadPack.mockResolvedValue({ pack: null });
  mockAnimationsEnabled.value = true;
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:poster"),
    revokeObjectURL: vi.fn(),
  });
});

describe("ThemeBackdrop saved animated-image poster", () => {
  it("loads the durable Blob poster after a saved theme is selected and revokes its URL", async () => {
    const poster = new Blob(["poster"], { type: "image/png" });
    mockLoadPoster.mockResolvedValue({ poster });
    const { container, unmount } = render(<ThemeBackdrop />);

    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:poster");
    });
    expect(mockLoadPoster).toHaveBeenCalledWith(MEDIA_ID);

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:poster");
  });

  it("plays a validated local frame pack over its poster when policy allows motion", async () => {
    const still = new Blob(["frame"], { type: "image/png" });
    mockLoadPoster.mockResolvedValue({ poster: new Blob(["poster"], { type: "image/png" }) });
    mockLoadPack.mockResolvedValue({
      pack: {
        version: 1,
        mediaId: MEDIA_ID,
        sourceFormat: "gif",
        sourceWidth: 2,
        sourceHeight: 1,
        width: 2,
        height: 1,
        durationMs: 200,
        plays: "infinite",
        frames: [
          { startMs: 0, durationMs: 100, still, width: 2, height: 1 },
          { startMs: 100, durationMs: 100, still, width: 2, height: 1 },
        ],
        byteLength: still.size * 2,
        droppedTransitions: false,
      },
    });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage } as never);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 2, height: 1, close: vi.fn() })));

    const { container } = render(<ThemeBackdrop />);
    await waitFor(() => expect(mockLoadPack).toHaveBeenCalledWith(MEDIA_ID, "desktop"));
    await waitFor(() => expect(container.querySelector(".theme-image-frame-canvas")).toBeInTheDocument());
    await waitFor(() => expect(drawImage).toHaveBeenCalled());
    expect(container.querySelectorAll(".theme-backdrop img")).toHaveLength(1);
  });

  it("does not read or decode the pack when global motion is disabled", async () => {
    mockAnimationsEnabled.value = false;
    mockLoadPoster.mockResolvedValue({ poster: new Blob(["poster"], { type: "image/png" }) });
    const { container } = render(<ThemeBackdrop />);

    await waitFor(() => expect(container.querySelector(".theme-backdrop img")).toBeInTheDocument());
    expect(mockLoadPack).not.toHaveBeenCalled();
    expect(container.querySelector(".theme-image-frame-canvas")).toBeNull();
  });

  it("ignores a poster read that finishes after the owner theme is removed", async () => {
    let finishRead!: (value: { poster: Blob }) => void;
    mockLoadPoster.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
    const createObjectURL = URL.createObjectURL;
    const { rerender, container } = render(<ThemeBackdrop />);

    mockTheme.current = { id: "fallback", variant: "dark", colors: { background: "#101010" } };
    rerender(<ThemeBackdrop />);
    await act(async () => {
      finishRead({ poster: new Blob(["late"], { type: "image/png" }) });
      await Promise.resolve();
    });

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(container.querySelector(".theme-backdrop")).toBeNull();
  });
});
