import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ImageAsset } from "../../../api/image-registry";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";
import { ImageOcclusionComposer, type ComposerSaveResult } from "../ImageOcclusionComposer";
import { occlusionFreeformTask, occlusionLabelSelectionTask } from "../../../lib/ai/tasks/definitions/occlusionTask";

const mockGetAsset = vi.hoisted(() => vi.fn());
const mockOcr = vi.hoisted(() => vi.fn());
const mockRunTask = vi.hoisted(() => vi.fn());
const mockAvailability = vi.hoisted(() => vi.fn());

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: mockGetAsset,
}));
vi.mock("../../../api/ocrCommands", () => ({
  ocrImageLabelsForOcclusion: mockOcr,
}));
vi.mock("../../../lib/ai/tasks", () => ({
  runTask: mockRunTask,
}));

/** Minimal settings-store surface: selector hook + getState for i18n. */
const settingsStore = vi.hoisted(() => {
  let current: { settings: { features: Record<string, boolean>; general: { language: string } } } = {
    settings: { features: {}, general: { language: "en" } },
  };
  const useSettingsStore = Object.assign(
    (selector: (s: typeof current) => unknown) => selector(current),
    {
      getState: () => current,
      setState: (next: typeof current) => {
        current = next;
      },
      subscribe: () => () => {},
    }
  );
  return useSettingsStore;
});

vi.mock("../../../stores/settingsStore", () => ({
  useSettingsStore: settingsStore,
}));
vi.mock("../../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: mockAvailability,
}));

const mockAsset: ImageAsset = {
  id: "asset-1",
  mime_type: "image/png",
  // 1x1 real PNG so the header-dimension decoder succeeds.
  data_url:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  byte_size: 123,
  sha256: "abc",
  created_at: "0",
  file_name: "cell-diagram.png",
};

const regionA: ImageOcclusionRegion = { id: "a", x: 0, y: 0, width: 10, height: 10, label: "term A" };

function settingsState(assist: boolean, freeform: boolean) {
  return {
    settings: {
      general: { language: "en" },
      features: { aiOcclusionAssist: assist, aiOcclusionFreeform: freeform },
    },
  };
}

function setup(initialRegions: ImageOcclusionRegion[] = []) {
  const onSave = vi.fn<(result: ComposerSaveResult) => void>();
  render(
    <ImageOcclusionComposer
      assetId="asset-1"
      initialRegions={initialRegions}
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return { onSave };
}

const ocrLabels = [
  { id: "ocr-0-a", text: "Membrane", x: 5, y: 5, width: 6, height: 3 },
  { id: "ocr-1-b", text: "Wall", x: 40, y: 10, width: 6, height: 3 },
];

function selectionResult() {
  return {
    taskId: occlusionLabelSelectionTask.id,
    output: {
      appropriate: true,
      selections: [
        { labelIds: ["ocr-0-a", "ocr-1-b"], question: "Which parts are shown?", answer: "Membrane and wall" },
      ],
      rejected: [{ labelId: "ocr-2-c", reason: "page number" }],
    },
    text: "",
    providerId: "fake-ondevice",
    providerKind: "ondevice" as const,
    requestedModelClass: "full" as const,
    servedModelClass: "full" as const,
    fallbackPath: "none" as const,
    validationOutcome: "strict-json" as const,
  };
}

describe("ImageOcclusionComposer AI assist (tasks 3.6–3.8)", () => {
  beforeEach(() => {
    mockGetAsset.mockReset().mockResolvedValue(mockAsset);
    mockOcr.mockReset().mockResolvedValue({ labels: ocrLabels, backend: "android-mlkit" });
    mockRunTask.mockReset().mockResolvedValue(selectionResult());
    settingsStore.setState(settingsState(true, false));
    mockAvailability.mockReset().mockReturnValue({ path: "ondevice", available: true, loading: false });
  });

  it("hides the assist panel while the feature flag is off (default)", async () => {
    settingsStore.setState(settingsState(false, false));
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    expect(screen.queryByTestId("assist-run")).not.toBeInTheDocument();
  });

  it("hides the assist panel when no AI path is available", async () => {
    mockAvailability.mockReturnValue({ path: "none", available: false, loading: false });
    setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument());
    expect(screen.queryByTestId("assist-run")).not.toBeInTheDocument();
  });

  it("runs OCR → task, proposes cards unaccepted, and saves accepted cards with their own question", async () => {
    const { onSave } = setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("assist-run")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("assist-run"));
    await waitFor(() => expect(screen.getByTestId("assist-card-0")).toBeInTheDocument());

    // OCR stats visible; nothing accepted yet so the save count is unchanged.
    expect(screen.getByTestId("assist-ocr-meta").textContent).toContain("2 labels found");
    expect(screen.getByText(/Save 1 card/)).toBeInTheDocument();

    // Rejected labels are listed with reasons.
    fireEvent.click(screen.getByTestId("assist-rejected"));
    expect(screen.getByText(/page number/)).toBeInTheDocument();

    // Accept the proposed card; its question is editable.
    fireEvent.click(screen.getByTestId("assist-card-accept-0"));
    fireEvent.change(screen.getAllByLabelText("Card question")[0], {
      target: { value: "Which parts protect the cell?" },
    });

    await waitFor(() => expect(screen.getByText(/Save 2 cards/)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("occlusion-save"));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const result = onSave.mock.calls[0][0] as ComposerSaveResult;
    expect(result.cards).toHaveLength(2);
    // The assist draft comes first with its own question and OCR-box regions.
    expect(result.cards[0]).toMatchObject({
      question: "Which parts protect the cell?",
      answer: "Membrane and wall",
    });
    expect(result.cards[0].hiddenRegions.map((r) => r.id)).toEqual(["ocr-0-a", "ocr-1-b"]);
    // The manual region still produces its own card with the shared question.
    expect(result.cards[1].hiddenRegions).toEqual([regionA]);
    // Provenance payload for the host (task 3.9).
    expect(result.assist?.provenance).toMatchObject({
      taskId: occlusionLabelSelectionTask.id,
      providerId: "fake-ondevice",
      usedFreeform: false,
    });
  });

  it("keeps manual authoring fully usable when OCR fails (spec)", async () => {
    mockOcr.mockRejectedValue(new Error("tesseract not installed"));
    const { onSave } = setup([regionA]);
    await waitFor(() => expect(screen.getByTestId("assist-run")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("assist-run"));
    await waitFor(() =>
      expect(screen.getByTestId("assist-status").textContent).toMatch(/AI assist failed/i),
    );

    // Manual region untouched and still saveable without assist drafts.
    expect(screen.getByTestId("region-list-row-1")).toBeInTheDocument();
    expect(screen.getByText(/Save 1 card/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("occlusion-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const result = onSave.mock.calls[0][0] as ComposerSaveResult;
    expect(result.cards).toHaveLength(1);
    expect(result.assist).toBeUndefined();
  });

  it("freeform path stays hidden unless the OCR found no labels and the flag is on", async () => {
    // Labels exist → freeform flag must not change anything.
    settingsStore.setState(settingsState(true, true));
    setup();
    await waitFor(() => expect(screen.getByTestId("assist-run")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("assist-run"));
    await waitFor(() => expect(mockRunTask).toHaveBeenCalledOnce());
    expect(mockRunTask.mock.calls[0][0]).toBe(occlusionLabelSelectionTask);
    expect(screen.queryByText(/Experimental:/i)).not.toBeInTheDocument();

    // OCR yields nothing → freeform runs and is labeled experimental.
    mockOcr.mockResolvedValue({ labels: [], backend: "android-mlkit" });
    mockRunTask.mockResolvedValue({
      taskId: occlusionFreeformTask.id,
      output: { regions: [{ id: "region-1", x: 10, y: 10, width: 20, height: 20 }], droppedOutOfBounds: 0, droppedDuplicate: 0 },
      providerId: "fake-ondevice",
      providerKind: "ondevice",
      servedModelClass: "full",
      fallbackPath: "none",
      validationOutcome: "strict-json",
    });
    fireEvent.click(screen.getByTestId("assist-run"));
    await waitFor(() => expect(mockRunTask).toHaveBeenCalledTimes(2));
    expect(mockRunTask.mock.calls[1][0]).toBe(occlusionFreeformTask);
    await waitFor(() => expect(screen.getByText(/Experimental:/i)).toBeInTheDocument());
  });

  it("reports no labels and never calls the model when freeform is disabled", async () => {
    mockOcr.mockResolvedValue({ labels: [], backend: "android-mlkit" });
    setup();
    await waitFor(() => expect(screen.getByTestId("assist-run")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("assist-run"));
    await waitFor(() =>
      expect(screen.getByTestId("assist-status").textContent).toMatch(/No text labels/i),
    );
    expect(mockRunTask).not.toHaveBeenCalled();
    // The freeform affordance is absent with the flag off.
    expect(screen.queryByTestId("assist-freeform-run")).not.toBeInTheDocument();
  });
});
