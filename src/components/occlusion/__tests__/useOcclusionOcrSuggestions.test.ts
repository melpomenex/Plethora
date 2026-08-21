import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImageAsset } from "../../../api/image-registry";
import { useOcclusionOcrSuggestions } from "../useOcclusionOcrSuggestions";
import { useOcclusionSession } from "../useOcclusionSession";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const asset: ImageAsset = {
  id: "asset-ocr",
  mime_type: "image/png",
  data_url: PNG_1PX,
  byte_size: 100,
  sha256: "sha-ocr",
  created_at: "2026-01-01T00:00:00Z",
  file_name: "diagram.png",
};

describe("useOcclusionOcrSuggestions", () => {
  it("keeps OCR detections pending until the author accepts them", async () => {
    const session = renderHook(() => useOcclusionSession());
    const ocrFn = vi.fn().mockResolvedValue({
      labels: [
        { id: "label-a", text: "Membrane", x: 10, y: 20, width: 18, height: 8, confidence: 0.95 },
        { id: "label-b", text: "Nucleus", x: 52, y: 54, width: 16, height: 10, confidence: 0.91 },
      ],
      backend: "rust-ocr" as const,
    });
    const ocr = renderHook(() =>
      useOcclusionOcrSuggestions(asset, session.result.current, { ocrFn }),
    );

    await act(async () => {
      await ocr.result.current.run();
    });

    expect(ocrFn).toHaveBeenCalledWith(expect.any(String), { maxResults: 64 });
    expect(ocr.result.current.status).toMatchObject({ kind: "ready", detected: 2, kept: 2 });
    expect(session.result.current.regions).toHaveLength(0);
    expect(session.result.current.suggestions).toHaveLength(2);

    act(() => {
      session.result.current.apply({
        type: "acceptSuggestion",
        id: session.result.current.suggestions[0].id ?? "",
      });
    });
    expect(session.result.current.regions).toHaveLength(1);
    expect(session.result.current.suggestions).toHaveLength(1);
  });

  it("reports an empty OCR result without creating regions", async () => {
    const session = renderHook(() => useOcclusionSession());
    const ocrFn = vi.fn().mockResolvedValue({ labels: [], backend: "android-mlkit" as const });
    const ocr = renderHook(() =>
      useOcclusionOcrSuggestions(asset, session.result.current, { ocrFn }),
    );

    await act(async () => {
      await ocr.result.current.run();
    });

    expect(ocr.result.current.status).toMatchObject({ kind: "no-labels", detected: 0 });
    expect(session.result.current.regions).toEqual([]);
    expect(session.result.current.suggestions).toEqual([]);
  });
});
