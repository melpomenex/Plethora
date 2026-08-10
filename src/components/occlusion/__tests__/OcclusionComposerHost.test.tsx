import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OcclusionComposerHost } from "../OcclusionComposerHost";
import type { ImageAsset } from "../../../api/image-registry";

const mockGetAsset = vi.hoisted(() => vi.fn());
const mockCreateBatch = vi.hoisted(() => vi.fn());

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: mockGetAsset,
}));
vi.mock("../../../api/learning-items", () => ({
  createLearningItemsBatch: mockCreateBatch,
}));
vi.mock("../../../stores", () => ({
  useStudyDeckStore: (selector: (state: unknown) => unknown) =>
    selector({ decks: [{ id: "deck-1", name: "Anatomy", tagFilters: ["anatomy"] }] }),
  useLLMProvidersStore: () => [],
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

const mockAsset: ImageAsset = {
  id: "asset-1",
  mime_type: "image/png",
  data_url: "data:image/png;base64,iVBORw0KGgo=",
  byte_size: 123,
  sha256: "abc",
  created_at: "0",
};

function dispatchOcclusionRequest(assetId: string, documentId?: string, deckId?: string) {
  window.dispatchEvent(
    new CustomEvent("incrementum:create-image-occlusion", {
      detail: { assetId, documentId, deckId },
    }),
  );
}

describe("OcclusionComposerHost", () => {
  beforeEach(() => {
    mockGetAsset.mockReset();
    mockGetAsset.mockResolvedValue(mockAsset);
    mockCreateBatch.mockReset();
    mockCreateBatch.mockResolvedValue([
      { id: "c1" },
      { id: "c2" },
    ]);
  });

  it("opens the composer for an occlusion request without any tab gating", async () => {
    render(<OcclusionComposerHost />);
    expect(screen.queryByTestId("occlusion-composer")).not.toBeInTheDocument();
    // Dispatch while "another tab is active" — there is no active-tab context
    // at the host, so the composer must open regardless.
    act(() => dispatchOcclusionRequest("asset-1", "doc-1"));
    await waitFor(() => expect(screen.getByTestId("occlusion-composer")).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Cancel closes it.
    fireEvent.click(screen.getByLabelText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("occlusion-composer")).not.toBeInTheDocument());
  });

  it("saves a session transactionally, carrying document, deck, asset and answers", async () => {
    render(<OcclusionComposerHost />);
    act(() => dispatchOcclusionRequest("asset-1", "doc-1", "deck-1"));
    await waitFor(() => expect(screen.getByTestId("occlusion-composer")).toBeInTheDocument());

    // Stub the canvas image so the viewport math has concrete numbers (the
    // asset loads asynchronously; wait for the image to exist first).
    await waitFor(() => expect(document.body.querySelector("img")).not.toBeNull());
    const img = document.body.querySelector("img") as HTMLImageElement;
    const rect = { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
    vi.spyOn(img, "getBoundingClientRect").mockReturnValue(rect);
    const container = img.closest('[tabindex="0"]') as HTMLElement;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect);
    act(() => fireEvent.load(img));

    // Draw a region and label it (the label becomes the card's answer).
    act(() => fireEvent.pointerDown(container, { pointerId: 1, clientX: 100, clientY: 100, button: 0 }));
    act(() => fireEvent.pointerMove(container, { pointerId: 1, clientX: 300, clientY: 200 }));
    act(() => fireEvent.pointerUp(container, { pointerId: 1 }));
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Save 1 card/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Regions 1"), { target: { value: "hippocampus" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("occlusion-save"));
    });
    await waitFor(() => expect(mockCreateBatch).toHaveBeenCalledTimes(1));    const inputs = mockCreateBatch.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      item_type: "qa",
      document_id: "doc-1",
      tags: ["anatomy"],
      image_asset_ids: ["asset-1"],
    });
    const metadata = inputs[0].interaction_metadata as Record<string, unknown>;
    expect(metadata.interactionType).toBe("image-occlusion");
    expect(metadata.imageOcclusionAssetId).toBe("asset-1");
    expect((metadata.imageOcclusionRegions as Array<{ label?: string }>)[0].label).toBe("hippocampus");
    expect(inputs[0].answer).toBe("hippocampus");
    // The composer closes after a successful whole-session save.
    await waitFor(() => expect(screen.queryByTestId("occlusion-composer")).not.toBeInTheDocument());
  });
});
