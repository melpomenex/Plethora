import { useCallback, useState } from "react";
import type { ImageAsset } from "../../api/image-registry";
import { ocrImageLabelsForOcclusion, type OcclusionOcrLabelsResult } from "../../api/ocrCommands";
import { filterOcclusionLabels, type OcclusionLabelCandidate } from "../../lib/ai/tasks/definitions/occlusionTask";
import { occlusionSourceFromAsset } from "../../lib/ai/tasks/definitions/occlusionSources";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import { clampRegion, isDuplicateRegion, regionHasUsableArea } from "../../utils/occlusion";
import type { OcclusionSession } from "./useOcclusionSession";

export type OcclusionOcrSuggestionStatus =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ready"; detected: number; kept: number; backend: OcclusionOcrLabelsResult["backend"] }
  | { kind: "no-labels"; detected: number; backend: OcclusionOcrLabelsResult["backend"] }
  | { kind: "error"; message?: string };

export interface UseOcclusionOcrSuggestionsOptions {
  /** Injected for deterministic UI tests. */
  ocrFn?: typeof ocrImageLabelsForOcclusion;
}

/**
 * Deterministic, local-first OCR workflow for the manual composer.
 *
 * OCR boxes are deliberately committed to `session.suggestions`, never to
 * `session.regions`, so a detection run cannot create cards without review.
 */
export function useOcclusionOcrSuggestions(
  asset: ImageAsset | null,
  session: OcclusionSession,
  options?: UseOcclusionOcrSuggestionsOptions,
) {
  const [status, setStatus] = useState<OcclusionOcrSuggestionStatus>({ kind: "idle" });
  const ocrFn = options?.ocrFn ?? ocrImageLabelsForOcclusion;
  const busy = status.kind === "running";

  const run = useCallback(async () => {
    if (!asset || busy) return;
    setStatus({ kind: "running" });
    try {
      const source = occlusionSourceFromAsset(asset);
      const result = await ocrFn(source.imageBase64, { maxResults: 64 });
      const labels: OcclusionLabelCandidate[] = result.labels.map((label) => ({
        id: label.id,
        text: label.text,
        confidence: label.confidence,
        x: label.x,
        y: label.y,
        width: label.width,
        height: label.height,
      }));
      const filtered = filterOcclusionLabels(labels, { maxLabels: 64 });
      const comparisonRegions = [...session.regions];
      const suggestions: ImageOcclusionRegion[] = [];

      for (const label of filtered.kept) {
      const candidate = clampRegion({
          id: `ocr-suggestion-${Date.now()}-${suggestions.length}`,
          x: label.x,
          y: label.y,
          width: label.width,
          height: label.height,
          label: label.text.trim(),
        });
        if (!regionHasUsableArea(candidate)) continue;
        if (isDuplicateRegion(candidate, [...comparisonRegions, ...suggestions], 0.85)) continue;
        suggestions.push(candidate);
      }

      session.apply({ type: "replaceSuggestions", suggestions });
      if (suggestions.length === 0) {
        setStatus({ kind: "no-labels", detected: labels.length, backend: result.backend });
      } else {
        setStatus({
          kind: "ready",
          detected: labels.length,
          kept: suggestions.length,
          backend: result.backend,
        });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : undefined,
      });
    }
  }, [asset, busy, ocrFn, session]);

  return { status, busy, run };
}
