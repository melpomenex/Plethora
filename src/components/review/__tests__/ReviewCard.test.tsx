import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewCard } from "../ReviewCard";
import { useSettingsStore } from "../../../stores/settingsStore";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

vi.mock("../../../hooks/useTTS", () => ({
  useTTS: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    pause: vi.fn(),
    resume: vi.fn(),
    isSupported: false,
  }),
}));

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: vi.fn(),
}));

const baseCard = {
  id: "card-1",
  item_type: "flashcard" as const,
  question: "Which answer is correct?",
  answer: "Paris",
  difficulty: 3,
  interval: 1,
  ease_factor: 2.5,
  due_date: new Date().toISOString(),
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  review_count: 0,
  lapses: 0,
  state: "new" as const,
  is_suspended: false,
  tags: [],
};

describe("ReviewCard", () => {
  it("renders and resolves multiple-choice cards", () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        general: { ...state.settings.general, language: "en" },
      },
    }));

    const onShowAnswer = vi.fn();
    const onInteractionResultChange = vi.fn();

    render(
      <ReviewCard
        card={{
          ...baseCard,
          interaction_metadata: {
            multipleChoiceOptions: [
              { id: "a", text: "London" },
              { id: "b", text: "Paris", isCorrect: true },
            ],
            multipleChoiceExplanation: "Paris is the capital of France.",
          },
        }}
        showAnswer={false}
        onShowAnswer={onShowAnswer}
        onInteractionResultChange={onInteractionResultChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /paris/i }));

    expect(onShowAnswer).toHaveBeenCalled();
    expect(onInteractionResultChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        interactionType: "multiple-choice",
        correct: true,
        selectedOptionId: "b",
      })
    );
  });

  it("renders image occlusion overlays before reveal", async () => {
    const { getImageAssetById } = await import("../../../api/image-registry");
    vi.mocked(getImageAssetById).mockResolvedValue({
      id: "asset-1",
      mime_type: "image/png",
      byte_size: 123,
      sha256: "abc",
      created_at: new Date().toISOString(),
      data_url: "data:image/png;base64,AAAA",
    });

    const onInteractionResultChange = vi.fn();
    render(
      <ReviewCard
        card={{
          ...baseCard,
          image_asset_ids: ["asset-1"],
          interaction_metadata: {
            imageOcclusionRegions: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
          },
        } as any}
        showAnswer={false}
        onShowAnswer={vi.fn()}
        onInteractionResultChange={onInteractionResultChange}
      />
    );

    expect(await screen.findByAltText("Image occlusion study prompt")).toBeInTheDocument();
    expect(onInteractionResultChange).toHaveBeenCalledWith(
      expect.objectContaining({ interactionType: "image-occlusion" })
    );
  });

  it("shrink-wraps the capped occlusion image and keeps tall-image regions inside it", async () => {
    const { getImageAssetById } = await import("../../../api/image-registry");
    vi.mocked(getImageAssetById).mockResolvedValue({
      id: "asset-tall",
      mime_type: "image/png",
      byte_size: 456,
      sha256: "abc",
      created_at: new Date().toISOString(),
      data_url: "data:image/png;base64,BBBB",
    });

    render(
      <ReviewCard
        card={{
          ...baseCard,
          image_asset_ids: ["asset-tall"],
          interaction_metadata: {
            // A tall source image with a region pinned to the very bottom —
            // the geometry that was clipped out of view before the height cap.
            imageOcclusionRegions: [
              { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
              { x: 0.4, y: 0.9, width: 0.3, height: 0.1 },
            ],
          },
        } as any}
        showAnswer={false}
        onShowAnswer={vi.fn()}
        onInteractionResultChange={vi.fn()}
      />
    );

    const img = await screen.findByAltText("Image occlusion study prompt");
    const imgClass = img.className;
    // Intrinsic sizing with both max constraints: the element box equals the
    // scaled bitmap, which is what keeps the percentage overlays aligned.
    expect(imgClass).toContain("h-auto");
    expect(imgClass).toContain("w-auto");
    expect(imgClass).toContain("max-w-full");
    expect(imgClass).toMatch(/max-h-\[/);

    const frame = screen.getByTestId("occlusion-image-frame");
    expect(frame.className).toContain("w-fit");
    expect(frame).toContainElement(img);

    const overlays = screen.getAllByTestId("occlusion-region-overlay");
    expect(overlays).toHaveLength(2);
    // Every overlay renders inside the shrink-wrap frame, i.e. in the image's
    // own coordinate space rather than a letterboxed full-width box.
    for (const overlay of overlays) {
      expect(frame).toContainElement(overlay);
    }
    // The bottom-most region stays within the visible area: 90% + 10% = 100%.
    const [top, bottom] = overlays;
    expect(bottom.style.top).toBe("90%");
    expect(bottom.style.height).toBe("10%");
    expect(top.style.top).toBe("10%");
  });

  it("keeps wide-image overlays aligned with the width-constrained image box", async () => {
    const { getImageAssetById } = await import("../../../api/image-registry");
    vi.mocked(getImageAssetById).mockResolvedValue({
      id: "asset-wide",
      mime_type: "image/png",
      byte_size: 789,
      sha256: "abc",
      created_at: new Date().toISOString(),
      data_url: "data:image/png;base64,CCCC",
    });

    render(
      <ReviewCard
        card={{
          ...baseCard,
          image_asset_ids: ["asset-wide"],
          interaction_metadata: {
            imageOcclusionRegions: [{ x: 0.75, y: 0.4, width: 0.2, height: 0.2 }],
          },
        } as any}
        showAnswer={false}
        onShowAnswer={vi.fn()}
        onInteractionResultChange={vi.fn()}
      />
    );

    const img = await screen.findByAltText("Image occlusion study prompt");
    expect(img.className).toContain("max-w-full");
    const frame = screen.getByTestId("occlusion-image-frame");
    expect(frame.className).toContain("w-fit");
    const overlay = screen.getByTestId("occlusion-region-overlay");
    expect(frame).toContainElement(overlay);
    expect(overlay.style.left).toBe("75%");
    expect(overlay.style.width).toBe("20%");
  });

  it("renders occlusion masks fully opaque by default and honors authored colors", async () => {
    const { getImageAssetById } = await import("../../../api/image-registry");
    vi.mocked(getImageAssetById).mockResolvedValue({
      id: "asset-1",
      mime_type: "image/png",
      byte_size: 123,
      sha256: "abc",
      created_at: new Date().toISOString(),
      data_url: "data:image/png;base64,AAAA",
    });

    render(
      <ReviewCard
        card={{
          ...baseCard,
          image_asset_ids: ["asset-1"],
          interaction_metadata: {
            imageOcclusionRegions: [
              { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
              { x: 0.4, y: 0.4, width: 0.2, height: 0.2, color: "#b91c1c" },
            ],
          },
        } as any}
        showAnswer={false}
        onShowAnswer={vi.fn()}
        onInteractionResultChange={vi.fn()}
      />
    );

    await screen.findByAltText("Image occlusion study prompt");
    const [defaultMask, authoredMask] = screen.getAllByTestId("occlusion-region-overlay");
    // Opaque slate-950 fallback — no alpha channel, no /85 utility variant.
    expect(defaultMask.className).toContain("bg-slate-950");
    expect(defaultMask.className).not.toContain("bg-slate-950/");
    expect(["#0f172a", "rgb(15, 23, 42)"]).toContain(defaultMask.style.backgroundColor);
    // An explicit composer-authored color wins over the default.
    expect(["#b91c1c", "rgb(185, 28, 28)"]).toContain(authoredMask.style.backgroundColor);
  });
});
