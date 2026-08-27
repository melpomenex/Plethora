import { useCallback, useMemo, useState } from "react";
import { chatWithContext, type LLMMessage, type LLMMessageContentPart } from "../../api/llm";
import type { ImageAsset } from "../../api/image-registry";
import { useLLMProvidersStore } from "../../stores";
import {
  buildImageOcclusionRefinementInstruction,
  IMAGE_OCCLUSION_SYSTEM_PROMPT,
  modelSupportsImageInput,
  normalizeOcclusionRegions,
  parseOcclusionResponse,
} from "../../utils/occlusionAI";
import type { OcclusionSession } from "./useOcclusionSession";

/**
 * AI region suggestion for the composer.
 *
 * Encapsulates the "Suggest regions" / refine flow: picks the configured
 * vision-capable provider, sends the open image with the shared occlusion
 * prompt, normalizes the response (clamping and duplicate-collapsing with
 * dropped-proposal accounting), and lands the results into the session's
 * `suggestions` — never `regions`. A re-run replaces only the pending
 * suggestions and tells the model which areas are already covered.
 *
 * Failures and parse failures preserve regions, suggestions and undo history:
 * nothing is dispatched and an error status is surfaced instead.
 */
export type SuggestionStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "dropped"; droppedOutOfBounds: number; droppedDuplicate: number }
  | { kind: "noUsable"; droppedOutOfBounds: number; droppedDuplicate: number }
  | { kind: "error"; message?: string };

export function useOcclusionSuggestions(asset: ImageAsset | null, session: OcclusionSession) {
  const providers = useLLMProvidersStore((state) => state.providers);

  const visionProvider = useMemo(() => {
    const enabled = providers.filter(
      (p) => p.enabled && modelSupportsImageInput(p.provider, p.model, p.baseUrl),
    );
    return enabled[0] ?? null;
  }, [providers]);

  const [isSuggesting, setIsSuggesting] = useState(false);
  const [status, setStatus] = useState<SuggestionStatus>({ kind: "idle" });
  const [hint, setHint] = useState("");

  const suggest = useCallback(
    async (refinementHint?: string) => {
      if (!asset || !visionProvider || isSuggesting) return;
      setIsSuggesting(true);
      setStatus({ kind: "busy" });
      try {
        const hintText = refinementHint?.trim() || hint.trim();
        const instruction = buildImageOcclusionRefinementInstruction(session.regions);
        const text = [
          hintText ? `Refinement request: ${hintText}` : "Propose occlusion regions for this image.",
          instruction,
        ]
          .filter(Boolean)
          .join("\n\n");

        const userContent: LLMMessageContentPart[] = [
          { type: "text", text },
          { type: "image_url", imageUrl: asset.data_url },
        ];
        const messages: LLMMessage[] = [
          { role: "system", content: IMAGE_OCCLUSION_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ];

        const response = await chatWithContext(
          visionProvider.provider,
          visionProvider.model,
          messages,
          { type: "general", maxOutputTokens: visionProvider.maxTokens },
          visionProvider.apiKey,
          visionProvider.baseUrl?.trim() || undefined,
          visionProvider.temperature,
          visionProvider.maxTokens,
          visionProvider.systemPrompt,
        );

        const raw = parseOcclusionResponse(response.content);
        const normalized = normalizeOcclusionRegions(raw, {
          existingRegions: session.regions,
        });
        // Landed suggestions always get fresh unique ids: the normalizer
        // assigns `region-<n>` per response, which a re-run could reuse after
        // earlier suggestions were accepted into the region list (duplicate
        // ids would break selection, deletion and React keys).
        const { regions: normalizedRegions, droppedOutOfBounds, droppedDuplicate } = normalized;
        const timestamp = Date.now();
        const regions = normalizedRegions.map((region, index) => ({
          ...region,
          id: `suggestion-${timestamp}-${index}`,
        }));

        // Land results into suggestions only — regions/history are untouched
        // by this action itself (the commit covers suggestions alone).
        session.apply({ type: "replaceSuggestions", suggestions: regions });

        if (regions.length === 0) {
          setStatus({ kind: "noUsable", droppedOutOfBounds, droppedDuplicate });
        } else if (droppedOutOfBounds > 0 || droppedDuplicate > 0) {
          setStatus({ kind: "dropped", droppedOutOfBounds, droppedDuplicate });
        } else {
          setStatus({ kind: "idle" });
        }
      } catch (error) {
        // Failure: keep regions, suggestions and history intact; surface the error.
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setIsSuggesting(false);
      }
    },
    [asset, visionProvider, isSuggesting, hint, session],
  );

  return {
    visionProvider,
    isSuggesting,
    status,
    hint,
    setHint,
    suggest,
  };
}
