import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImageAsset } from "../../../api/image-registry";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";
import { ImageOcclusionComposer, type ComposerSaveResult } from "../ImageOcclusionComposer";

const mockGetAsset = vi.hoisted(() => vi.fn());
vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: mockGetAsset,
}));

const mockAsset: ImageAsset = {
  id: "asset-1",
  mime_type: "image/png",
  data_url: "data:image/png;base64,iVBORw0KGgo=",
  byte_size: 123,
  sha256: "abc",
  created_at: "0",
};

const regionA: ImageOcclusionRegion = { id: "a", x: 0, y: 0, width: 10, height: 10, label: "term A" };
const regionB: ImageOcclusionRegion = { id: "b", x: 20, y: 20, width: 10, height: 10, label: "term B" };

function setup(initialRegions: ImageOcclusionRegion[] = []) {
  const onSave = vi.fn<(result: ComposerSaveResult) => void>();
  const onCancel = vi.fn();
  const utils = render(
    <ImageOcclusionComposer
      assetId="asset-1"
      initialRegions={initialRegions}
      documentId="doc-1"
      deckId="deck-1"
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onSave, onCancel };
}

describe("ImageOcclusionComposer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockGetAsset.mockReset();
    mockGetAsset.mockResolvedValue(mockAsset);
  });

  it("shows the asset after loading and lists the initial regions", async () => {
    setup([regionA, regionB]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    expect(screen.getByTestId("region-list-row-2")).toBeInTheDocument();
  });

  it("preview card count tracks the mode and region changes", async () => {
    setup([regionA, regionB]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    // hide-all default: two regions -> two cards, each masking all regions
    expect(screen.getByText(/Card 1 of 2/)).toBeInTheDocument();
    expect(screen.getAllByTestId("occlusion-preview-mask")).toHaveLength(2);

    // switch to hide-one -> two cards, but each masks only its target
    fireEvent.click(screen.getByTestId("mode-hide-one"));
    expect(screen.getByText(/Card 1 of 2/)).toBeInTheDocument();
    expect(screen.getAllByTestId("occlusion-preview-mask")).toHaveLength(1);

    // back to hide-all
    fireEvent.click(screen.getByTestId("mode-hide-all"));
    expect(screen.getByText(/Card 1 of 2/)).toBeInTheDocument();
    expect(screen.getAllByTestId("occlusion-preview-mask")).toHaveLength(2);

    // deleting a region shrinks the count
    fireEvent.click(screen.getByLabelText(/Delete 2/));
    expect(screen.getByText(/Card 1 of 1/)).toBeInTheDocument();
    // geometry untouched by mode switches: the remaining region is intact
    expect(screen.getByLabelText("Regions 1")).toHaveValue("term A");
  });

  it("disables save with no regions and explains why", async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId("occlusion-save")).toBeDisabled());
    expect(screen.getByText(/at least one region/i)).toBeInTheDocument();
  });

  it("drops zero-area regions on save and reports the real card count", async () => {
    const zeroArea: ImageOcclusionRegion = { id: "zero", x: 95, y: 0, width: 20, height: 10 };
    const { onSave } = setup([regionA, zeroArea]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    expect(screen.getByText(/Save 1 card/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("occlusion-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload.regions.map((r) => r.id)).toEqual(["a"]);
    expect(payload.cards).toHaveLength(1);
    expect(payload.mode).toBe("hide-all");
    expect(payload.documentId).toBe("doc-1");
    expect(payload.deckId).toBe("deck-1");
  });

  it("cancel emits nothing and never calls save", async () => {
    const { onSave, onCancel } = setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    // No edits yet: cancel closes immediately.
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("prompts before discarding unsaved work and discards only on confirm", async () => {
    const { onSave, onCancel } = setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    // Make an edit so the session holds unsaved work (relabel region A).
    const labelInput = screen.getByLabelText("Regions 1");
    fireEvent.change(labelInput, { target: { value: "renamed" } });
    // Cancel now triggers the confirmation.
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("discard-confirm")).toBeInTheDocument();
    // Keep editing: dialog closes, composer stays.
    fireEvent.click(screen.getByText("Keep editing"));
    expect(screen.queryByTestId("discard-confirm")).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    // Cancel again and discard.
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByTestId("discard-confirm"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("the divider resizes the sidebar and clamps to its bounds", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    const body = document.body.querySelector('[data-testid="occlusion-composer-body"]') as HTMLElement;
    const rect = { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect);
    const handle = screen.getByTestId("occlusion-resize-handle");
    const aside = document.body.querySelector("aside") as HTMLElement;

    // Drag from x=800 to x=700: sidebar widens from 400px to 500px.
    act(() => fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 }));
    act(() => fireEvent.pointerMove(window, { pointerId: 1, clientX: 700 }));
    act(() => fireEvent.pointerUp(window, { pointerId: 1 }));
    expect(aside.style.getPropertyValue("--occlusion-sidebar-w")).toBe("500px");

    // Dragging far left clamps to the maximum (560px).
    act(() => fireEvent.pointerDown(handle, { pointerId: 1, clientX: 700 }));
    act(() => fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 }));
    act(() => fireEvent.pointerUp(window, { pointerId: 1 }));
    expect(aside.style.getPropertyValue("--occlusion-sidebar-w")).toBe("560px");

    // Dragging far right clamps to the minimum (240px).
    act(() => fireEvent.pointerDown(handle, { pointerId: 1, clientX: 700 }));
    act(() => fireEvent.pointerMove(window, { pointerId: 1, clientX: 2000 }));
    act(() => fireEvent.pointerUp(window, { pointerId: 1 }));
    expect(aside.style.getPropertyValue("--occlusion-sidebar-w")).toBe("240px");
  });

  it("persists the resized sidebar width and restores it when the composer reopens", async () => {
    const first = setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    const body = document.body.querySelector('[data-testid="occlusion-composer-body"]') as HTMLElement;
    const rect = { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect);
    const handle = screen.getByTestId("occlusion-resize-handle");

    // Resize to 500px — the choice is written to localStorage.
    act(() => fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 }));
    act(() => fireEvent.pointerMove(window, { pointerId: 1, clientX: 700 }));
    act(() => fireEvent.pointerUp(window, { pointerId: 1 }));
    expect(window.localStorage.getItem("occlusion-composer-sidebar-width")).toBe("500");

    // Close the composer and reopen it: a fresh instance starts at the stored width.
    first.unmount();
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    const reopenedAside = document.body.querySelector("aside") as HTMLElement;
    expect(reopenedAside.style.getPropertyValue("--occlusion-sidebar-w")).toBe("500px");
  });
});
