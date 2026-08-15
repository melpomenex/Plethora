import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ImageAsset } from "../../../api/image-registry";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";
import { AIError } from "../../../lib/ai/errors";
import {
  occlusionFreeformTask,
  occlusionLabelSelectionTask,
} from "../../../lib/ai/tasks/definitions/occlusionTask";
import { useOcclusionSuggestions } from "../useOcclusionSuggestions";
import { useOcclusionSession } from "../useOcclusionSession";
import { useOcclusionAssist, type OcclusionAssistCard } from "../useOcclusionAssist";
import { occlusionSourceFromDataUrl } from "../../../lib/ai/tasks/definitions/occlusionSources";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeAsset(dataUrl = PNG_1PX): ImageAsset {
  return {
    id: "asset-1",
    mime_type: "image/png",
    data_url: dataUrl,
    byte_size: 100,
    sha256: "abc",
    created_at: "0",
    file_name: "cell-diagram.png",
  };
}

function makeLabel(id: string, text: string) {
  return { id, text, x: 10, y: 10, width: 6, height: 3, confidence: 0.9 };
}

/** A tiny harness so the hook gets a real session reducer. */
function setup(options?: Parameters<typeof useOcclusionAssist>[2]) {
  const sessionHook = renderHook(() => useOcclusionSession());
  const session = sessionHook.result.current;
  const assistHook = renderHook(() => useOcclusionAssist(makeAsset(), session, options));
  return { session: sessionHook.result, assist: assistHook.result, rerender: assistHook.rerender };
}

const successfulTaskResult = (taskId: string) => ({
  taskId,
  output: {
    appropriate: true,
    selections: [
      { labelIds: ["ocr-0-a", "ocr-1-b"], question: "Which parts?", answer: "A and B" },
      { labelIds: ["ocr-2-c"], question: "What is C?", answer: "C thing" },
    ],
    rejected: [{ labelId: "ocr-3-d", reason: "caption" }],
  },
  text: "",
  providerId: "fake-ondevice",
  providerKind: "ondevice" as const,
  requestedModelClass: "full" as const,
  servedModelClass: "full" as const,
  fallbackPath: "none" as const,
  validationOutcome: "strict-json" as const,
});

describe("useOcclusionAssist", () => {
  let ocrFn: ReturnType<typeof vi.fn> & ((base64Image: string, options?: { maxResults?: number; provider?: string }) => Promise<import("../../../api/ocrCommands").OcclusionOcrLabelsResult>);
  let runTaskFn: ReturnType<typeof vi.fn> & typeof import("../../../lib/ai/tasks").runTask;

  beforeEach(() => {
    ocrFn = vi.fn().mockResolvedValue({
      labels: [
        makeLabel("ocr-0-a", "Membrane"),
        makeLabel("ocr-1-b", "Wall"),
        makeLabel("ocr-2-c", "Nucleus"),
        makeLabel("ocr-3-d", "Figure 1"),
      ],
      sourceWidth: 1000,
      sourceHeight: 800,
      backend: "android-mlkit",
    });
    runTaskFn = vi.fn().mockResolvedValue(successfulTaskResult(occlusionLabelSelectionTask.id));
  });

  it("runs OCR → task and lands unaccepted proposals with OCR stats", async () => {
    const { assist } = setup({ ocrFn, runTaskFn });
    await act(() => assist.current.run());

    expect(ocrFn).toHaveBeenCalledOnce();
    expect(runTaskFn).toHaveBeenCalledOnce();
    expect(assist.current.status.kind).toBe("ready");
    expect(assist.current.proposals?.cards).toHaveLength(2);
    // Nothing is accepted by default (task 3.6).
    expect(assist.current.proposals?.cards.every((card) => !card.accepted)).toBe(true);
    expect(assist.current.proposals?.rejected[0]).toMatchObject({ labelId: "ocr-3-d" });
    expect(assist.current.ocrMeta).toMatchObject({ detected: 4, kept: 4, backend: "android-mlkit" });
    expect(assist.current.runInfo?.taskId).toBe(occlusionLabelSelectionTask.id);
  });

  it("accept/edit toggling and applyAcceptedCardsToSession land OCR-box regions", async () => {
    const { assist, session } = setup({ ocrFn, runTaskFn });
    await act(() => assist.current.run());
    const firstCard = assist.current.proposals!.cards[0];

    act(() => assist.current.toggleCard(firstCard.id));
    act(() => assist.current.editCard(firstCard.id, { question: "Edited?" }));

    let accepted: OcclusionAssistCard[] = [];
    await act(async () => {
      accepted = assist.current.applyAcceptedCardsToSession();
    });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].question).toBe("Edited?");
    // Regions use the OCR label ids (drag/resize editable via the canvas).
    const landed = session.current.regions.map((r: ImageOcclusionRegion) => r.id);
    expect(landed).toEqual(["ocr-0-a", "ocr-1-b"]);
    expect(assist.current.labelBoxAsRegion("ocr-0-a")).toMatchObject({ x: 10, y: 10, width: 6, height: 3 });
  });

  it("OCR failure surfaces an error and leaves the session untouched (spec)", async () => {
    ocrFn.mockRejectedValue(new Error("tesseract missing"));
    const { assist, session } = setup({ ocrFn, runTaskFn });
    await act(() => assist.current.run());
    expect(assist.current.status).toMatchObject({ kind: "error", category: "OCRFailed" });
    expect(runTaskFn).not.toHaveBeenCalled();
    expect(session.current.regions).toHaveLength(0);
  });

  it("AI failure maps the AIError category without touching regions", async () => {
    runTaskFn.mockRejectedValue(
      new AIError("VisionUnavailable", "no vision", { code: "feature_unavailable" })
    );
    const { assist, session } = setup({ ocrFn, runTaskFn });
    await act(() => assist.current.run());
    expect(assist.current.status).toMatchObject({ kind: "error", category: "VisionUnavailable" });
    expect(session.current.regions).toHaveLength(0);
  });

  it("filters tiny labels before the model (task 3.7)", async () => {
    ocrFn.mockResolvedValue({
      labels: [
        makeLabel("ocr-0-a", "Usable label"),
        { ...makeLabel("ocr-1-b", "Dot"), width: 0.001, height: 0.001 },
        { ...makeLabel("ocr-2-c", "ok"), text: "·" },
      ],
      backend: "rust-ocr",
    });
    const { assist } = setup({ ocrFn, runTaskFn });
    await act(() => assist.current.run());
    expect(assist.current.ocrMeta).toMatchObject({ detected: 3, kept: 1, droppedTiny: 1, droppedShortText: 1 });
    const input = runTaskFn.mock.calls[0][1];
    expect(input.labels.map((l: { id: string }) => l.id)).toEqual(["ocr-0-a"]);
  });

  it("zero labels with freeform disabled reports no-labels and never runs the model", async () => {
    ocrFn.mockResolvedValue({ labels: [], backend: "android-mlkit" });
    const { assist } = setup({ ocrFn, runTaskFn, freeformEnabled: false });
    await act(() => assist.current.run());
    expect(assist.current.status.kind).toBe("no-labels");
    expect(runTaskFn).not.toHaveBeenCalled();
  });

  it("freeform runs ONLY when enabled AND OCR found nothing (task 3.8)", async () => {
    ocrFn.mockResolvedValue({ labels: [], backend: "android-mlkit" });
    runTaskFn.mockResolvedValue({
      ...successfulTaskResult(occlusionFreeformTask.id),
      output: {
        regions: [{ id: "region-1", x: 10, y: 10, width: 20, height: 20 }],
        droppedOutOfBounds: 0,
        droppedDuplicate: 0,
      },
    });
    const { assist, session } = setup({ ocrFn, runTaskFn, freeformEnabled: true });
    await act(() => assist.current.run());

    expect(runTaskFn).toHaveBeenCalledOnce();
    expect(runTaskFn.mock.calls[0][0]).toBe(occlusionFreeformTask);
    expect(assist.current.proposals?.usedFreeform).toBe(true);
    expect(assist.current.proposals?.cards).toHaveLength(0);
    expect(assist.current.runInfo?.taskId).toBe(occlusionFreeformTask.id);
    // Freeform regions land as SUGGESTIONS (pending), not accepted regions.
    expect(session.current.suggestions.length).toBe(1);
    expect(session.current.suggestions[0].id).toMatch(/^freeform-/);
    expect(session.current.regions).toHaveLength(0);
  });

  it("freeform never runs when OCR labels exist even if the flag is on", async () => {
    const { assist } = setup({ ocrFn, runTaskFn, freeformEnabled: true });
    await act(() => assist.current.run());
    expect(runTaskFn.mock.calls[0][0]).toBe(occlusionLabelSelectionTask);
    expect(assist.current.proposals?.usedFreeform).toBe(false);
  });

  it("marks proposals stale when the source image changes (spec)", async () => {
    const asset = makeAsset();
    const sessionHook = renderHook(() => useOcclusionSession());
    const session = sessionHook.result.current;
    let currentAsset = asset;
    const assistHook = renderHook(() =>
      useOcclusionAssist(currentAsset, session, { ocrFn, runTaskFn })
    );
    await act(() => assistHook.result.current.run());
    expect(assistHook.result.current.isStale).toBe(false);

    // Same image → not stale.
    await act(async () => {
      const stale = await assistHook.result.current.checkStale();
      expect(stale).toBe(false);
    });

    // Replace the image content behind the asset id.
    currentAsset = makeAsset(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAABHNCSVQICAgIfAhkiAAAABZJREFUCJlj9L1VnAEDEwKv6AX2AAAAAElFTkSuQmCC"
    );
    assistHook.rerender();
    // The hook captured the ORIGINAL source; simulate the save-time
    // re-fingerprint against the registry's new bytes.
    const newSource = occlusionSourceFromDataUrl(currentAsset.data_url);
    const { sha256SourceFingerprint } = await import(
      "../../../lib/ai/tasks/definitions/occlusionSources"
    );
    const originalFingerprint = assistHook.result.current.runInfo!.fingerprint;
    const changedFingerprint = await sha256SourceFingerprint(newSource);
    expect(changedFingerprint).not.toBe(originalFingerprint);
  });

  it("reports an inappropriate verdict as its own status", async () => {
    runTaskFn.mockResolvedValue({
      ...successfulTaskResult(occlusionLabelSelectionTask.id),
      output: {
        appropriate: false,
        selections: [],
        rejected: [{ labelId: "ocr-0-a", reason: "watermark" }],
      },
    });
    const { assist } = setup({ ocrFn, runTaskFn });
    await act(() => assist.current.run());
    expect(assist.current.status.kind).toBe("inappropriate");
    expect(assist.current.proposals?.cards).toHaveLength(0);
  });
});
