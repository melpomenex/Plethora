import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudioOcclusionComposerLauncher } from "../StudioOcclusionComposerLauncher";
import type { ImageAsset } from "../../../../api/image-registry";
import type { ImageOcclusionRegion } from "../../../../types/learningItemInteractions";

const mockGetAsset = vi.hoisted(() => vi.fn());
const mockCreateBatch = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/image-registry", () => ({
  getImageAssetById: mockGetAsset,
}));
vi.mock("../../../../api/learning-items", () => ({
  createLearningItemsBatch: mockCreateBatch,
}));
vi.mock("../../../../stores", () => ({
  useStudyDeckStore: () => [],
  useLLMProvidersStore: () => [],
}));

const mockAsset: ImageAsset = {
  id: "asset-1",
  mime_type: "image/png",
  data_url: "data:image/png;base64,iVBORw0KGgo=",
  byte_size: 123,
  sha256: "abc",
  created_at: "0",
};

const region: ImageOcclusionRegion = { id: "a", x: 0, y: 0, width: 10, height: 10, label: "term A" };

describe("StudioOcclusionComposerLauncher", () => {
  beforeEach(() => {
    mockGetAsset.mockReset();
    mockGetAsset.mockResolvedValue(mockAsset);
    mockCreateBatch.mockReset();
  });

  it("shows a placeholder when no image is selected for the draft", () => {
    render(
      <StudioOcclusionComposerLauncher
        assetId={undefined}
        regions={[]}
        onRegionsChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("open-occlusion-composer")).not.toBeInTheDocument();
  });

  it("round-trips draft regions through the composer without creating cards", async () => {
    const onRegionsChange = vi.fn();
    render(
      <StudioOcclusionComposerLauncher
        assetId="asset-1"
        regions={[region]}
        onRegionsChange={onRegionsChange}
        documentId="doc-1"
      />,
    );
    fireEvent.click(screen.getByTestId("open-occlusion-composer"));
    // The composer opens with the draft's regions already loaded.
    await waitFor(() => expect(screen.getByTestId("occlusion-composer")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    expect(screen.getByLabelText("Regions 1")).toHaveValue("term A");

    // Edit the label inside the composer and save.
    fireEvent.change(screen.getByLabelText("Regions 1"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByTestId("occlusion-save"));

    // Regions are written back to the draft form...
    await waitFor(() => expect(onRegionsChange).toHaveBeenCalledTimes(1));
    const writtenBack = onRegionsChange.mock.calls[0][0] as ImageOcclusionRegion[];
    expect(writtenBack).toHaveLength(1);
    expect(writtenBack[0]).toMatchObject({ id: "a", x: 0, y: 0, width: 10, height: 10, label: "renamed" });
    // ...and the composer closes.
    await waitFor(() => expect(screen.queryByTestId("occlusion-composer")).not.toBeInTheDocument());

    // The draft-edit path must never create cards.
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });

  it("cancel closes the composer without touching the draft", async () => {
    const onRegionsChange = vi.fn();
    render(
      <StudioOcclusionComposerLauncher assetId="asset-1" regions={[region]} onRegionsChange={onRegionsChange} />,
    );
    fireEvent.click(screen.getByTestId("open-occlusion-composer"));
    await waitFor(() => expect(screen.getByTestId("occlusion-composer")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("occlusion-composer")).not.toBeInTheDocument());
    expect(onRegionsChange).not.toHaveBeenCalled();
    expect(mockCreateBatch).not.toHaveBeenCalled();
  });
});
