import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImageAsset } from "../../../api/image-registry";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";
import { ImageOcclusionComposer, type ComposerSaveResult } from "../ImageOcclusionComposer";

const mockGetAsset = vi.hoisted(() => vi.fn());
const mockChat = vi.hoisted(() => vi.fn());
const mockProviders = vi.hoisted(() => vi.fn());

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: mockGetAsset,
}));
vi.mock("../../../api/llm", () => ({
  chatWithContext: mockChat,
}));
vi.mock("../../../stores", () => ({
  useLLMProvidersStore: mockProviders,
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

const visionProvider = {
  id: "p1",
  provider: "openai",
  name: "OpenAI",
  apiKey: "k",
  baseUrl: "",
  model: "gpt-4o",
  enabled: true,
  temperature: 0.7,
  maxTokens: 2000,
};

function responseJson(content: string) {
  return { content };
}

function setup(initialRegions: ImageOcclusionRegion[] = []) {
  const onSave = vi.fn<(result: ComposerSaveResult) => void>();
  const onCancel = vi.fn();
  const utils = render(
    <ImageOcclusionComposer
      assetId="asset-1"
      initialRegions={initialRegions}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );
  return { ...utils, onSave, onCancel };
}

/** Stub the canvas image so suggestion overlays (which need imgBounds) render. */
async function stubCanvasImage() {
  // The composer portals to document.body, so query there. Wait for the image
  // to exist — the asset loads asynchronously and the canvas mounts with it.
  await waitFor(() => expect(document.body.querySelector("img")).not.toBeNull());
  const img = document.body.querySelector("img") as HTMLImageElement;
  const container = img.closest('[tabindex="0"]') as HTMLElement;
  const rect = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
  Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 600, configurable: true });
  vi.spyOn(img, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect);
  act(() => fireEvent.load(img));
}

describe("ImageOcclusionComposer AI suggestions", () => {
  beforeEach(() => {
    mockGetAsset.mockReset();
    mockGetAsset.mockResolvedValue(mockAsset);
    mockChat.mockReset();
    mockProviders.mockReset();
    mockProviders.mockReturnValue([visionProvider]);
  });

  it("disables suggestions with an explanation when no vision model is configured", async () => {
    mockProviders.mockReturnValue([]);
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    expect(screen.queryByTestId("suggest-regions")).not.toBeInTheDocument();
    expect(screen.getByText(/vision-capable model/i)).toBeInTheDocument();
  });

  it("lands proposals as pending suggestions without changing the preview count", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    await stubCanvasImage();
    mockChat.mockResolvedValue(
      responseJson('```json\n{ "regions": [{ "bbox": [100, 100, 200, 200] }, { "bbox": [300, 300, 400, 400] }] }\n```'),
    );
    fireEvent.click(screen.getByTestId("suggest-regions"));
    await waitFor(() => expect(screen.getByText(/2 suggestion\(s\) pending/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("occlusion-suggestion-1")).toBeInTheDocument());
    expect(screen.getByTestId("occlusion-suggestion-2")).toBeInTheDocument();
    // Pending suggestions never enter the region list or the preview.
    expect(screen.queryByTestId("region-list-row-2")).not.toBeInTheDocument();
    expect(screen.getByText(/Card 1 of 1/)).toBeInTheDocument();
  });

  it("accept-all moves suggestions into the region list; re-run preserves accepted regions", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    await stubCanvasImage();
    mockChat.mockResolvedValue(
      responseJson('```json\n{ "regions": [{ "bbox": [100, 100, 200, 200], "label": "axis" }] }\n```'),
    );
    fireEvent.click(screen.getByTestId("suggest-regions"));
    await waitFor(() => expect(screen.getByTestId("accept-all-suggestions")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("accept-all-suggestions"));
    await waitFor(() => expect(screen.getByTestId("region-list-row-2")).toBeInTheDocument());
    expect(screen.queryByTestId("accept-all-suggestions")).not.toBeInTheDocument();

    // Re-run (refine) with a hint: accepted/manual regions survive.
    mockChat.mockResolvedValue(
      responseJson('```json\n{ "regions": [{ "bbox": [500, 500, 600, 600] }] }\n```'),
    );
    fireEvent.change(screen.getByPlaceholderText(/Optional hint/), { target: { value: "hide the axis labels" } });
    fireEvent.click(screen.getByTestId("refine-suggestions"));
    await waitFor(() => expect(screen.getByTestId("occlusion-suggestion-1")).toBeInTheDocument());
    expect(screen.getByTestId("region-list-row-2")).toBeInTheDocument();
    expect(screen.getByLabelText("Regions 2")).toHaveValue("axis");
  });

  it("reports dropped proposals and surfaces them in the composer", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    await stubCanvasImage();
    mockChat.mockResolvedValue(
      responseJson('```json\n{ "regions": [{ "bbox": [100, 100, 200, 200] }, { "bbox": [1000, 1000, 1100, 1100] }] }\n```'),
    );
    fireEvent.click(screen.getByTestId("suggest-regions"));
    await waitFor(() => expect(screen.getByTestId("occlusion-suggestion-1")).toBeInTheDocument());
    expect(screen.getByText(/1 proposal\(s\) discarded/)).toBeInTheDocument();
    expect(screen.queryByTestId("occlusion-suggestion-2")).not.toBeInTheDocument();
  });

  it("reports when the model produces no usable regions without losing existing work", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    mockChat.mockResolvedValue(responseJson('```json\n{ "regions": [{ "bbox": [1000, 1000, 1100, 1100] }] }\n```'));
    fireEvent.click(screen.getByTestId("suggest-regions"));
    await waitFor(() => expect(screen.getByText(/no usable regions/i)).toBeInTheDocument());
    // Manual region untouched, still editable and saveable.
    expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument();
    expect(screen.getByText(/Save 1 card/)).toBeInTheDocument();
  });

  it("preserves regions, suggestions and history on request failure", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    await stubCanvasImage();
    // Make an edit first so the session holds history that must survive.
    fireEvent.change(screen.getByLabelText("Regions 1"), { target: { value: "renamed" } });
    mockChat.mockRejectedValue(new Error("network down"));
    fireEvent.click(screen.getByTestId("suggest-regions"));
    await waitFor(() => expect(screen.getByText(/request failed/i)).toBeInTheDocument());
    expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument();
    expect(screen.getByLabelText("Regions 1")).toHaveValue("renamed");
    expect(screen.queryByTestId("occlusion-suggestion-1")).not.toBeInTheDocument();
    // Undo history from before the attempt is still intact.
    expect(screen.getByLabelText("Undo")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("Undo"));
    expect(screen.getByLabelText("Regions 1")).toHaveValue("term A");
  });

  it("rejects all suggestions in one action", async () => {
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    mockChat.mockResolvedValue(
      responseJson('```json\n{ "regions": [{ "bbox": [100, 100, 200, 200] }, { "bbox": [300, 300, 400, 400] }] }\n```'),
    );
    fireEvent.click(screen.getByTestId("suggest-regions"));
    await waitFor(() => expect(screen.getByTestId("reject-all-suggestions")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("reject-all-suggestions"));
    await waitFor(() => expect(screen.queryByTestId("reject-all-suggestions")).not.toBeInTheDocument());
    expect(screen.queryByTestId("region-list-row-2")).not.toBeInTheDocument();
  });
});
