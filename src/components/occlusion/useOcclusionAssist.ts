import { useCallback, useMemo, useRef, useState } from "react";
import type { ImageAsset } from "../../api/image-registry";
import { ocrImageLabelsForOcclusion } from "../../api/ocrCommands";
import { runTask } from "../../lib/ai/tasks";
import {
  filterOcclusionLabels,
  occlusionFreeformTask,
  occlusionLabelSelectionTask,
  type OcclusionLabelCandidate,
} from "../../lib/ai/tasks/definitions/occlusionTask";
import {
  occlusionSourceFromAsset,
  sha256SourceFingerprint,
  type OcclusionSource,
} from "../../lib/ai/tasks/definitions/occlusionSources";
import { AIError } from "../../lib/ai/errors";
import type { ImageOcclusionRegion } from "../../types/learningItemInteractions";
import type { OcclusionSession } from "./useOcclusionSession";

/**
 * OCR-backed occlusion assistance for the composer (design D18, tasks
 * 3.6–3.8).
 *
 * Pipeline: deterministic OCR (Android ML Kit, else Rust providers) →
 * tiny/dense label filtering → `occlusionLabelSelectionTask` (vision, full
 * class) → proposed cards the user accepts/edits individually. Geometry is
 * only ever the OCR box; the model's job is selection, wording, grouping,
 * and an explicit "not appropriate" verdict with per-label rejection reasons.
 *
 * Failure discipline: every error lands in `status` as an OCRFailed/AI error
 * message — regions, suggestions, and undo history are untouched, so manual
 * authoring is never affected. Source-image staleness is fingerprinted at
 * propose time and re-checked at save time by the composer.
 */

export type OcclusionAssistStatus =
  | { kind: "idle" }
  | { kind: "ocr-running" }
  | { kind: "ai-running" }
  | { kind: "ready" }
  | { kind: "inappropriate" }
  | { kind: "no-labels" }
  | { kind: "error"; message?: string; category?: string };

export interface OcclusionAssistCard {
  /** Stable per-proposal card id (`assist-<timestamp>-<index>`). */
  id: string;
  labelIds: string[];
  question: string;
  answer: string;
  /** Acceptance is per card and NEVER defaults to true (task 3.6). */
  accepted: boolean;
}

export interface OcclusionAssistRejection {
  labelId: string;
  text?: string;
  reason: string;
}

export interface OcclusionAssistProposals {
  appropriate: boolean;
  cards: OcclusionAssistCard[];
  rejected: OcclusionAssistRejection[];
  /** True when the experimental freeform path produced the regions. */
  usedFreeform: boolean;
}

/** OCR statistics surfaced in the panel (task 3.7 transparency). */
export interface OcclusionAssistOcrMeta {
  detected: number;
  kept: number;
  droppedTiny: number;
  droppedShortText: number;
  droppedDense: number;
  backend: "android-mlkit" | "rust-ocr";
}

/** Provenance payload for accepted cards (task 3.9). */
export interface OcclusionAssistRunInfo {
  taskId: string;
  providerId: string;
  providerKind: "ondevice" | "cloud";
  servedModelClass: string;
  baseModelName?: string;
  /** sha256 of the source image at propose time. */
  fingerprint: string;
}

export interface UseOcclusionAssistOptions {
  /** `aiOcclusionFreeform` — experimental non-OCR path (default false). */
  freeformEnabled?: boolean;
  /** Injected for tests. */
  runTaskFn?: typeof runTask;
  ocrFn?: typeof ocrImageLabelsForOcclusion;
}

export function useOcclusionAssist(
  asset: ImageAsset | null,
  session: OcclusionSession,
  options?: UseOcclusionAssistOptions
) {
  const [status, setStatus] = useState<OcclusionAssistStatus>({ kind: "idle" });
  const [proposals, setProposals] = useState<OcclusionAssistProposals | null>(null);
  const [ocrMeta, setOcrMeta] = useState<OcclusionAssistOcrMeta | null>(null);
  const [runInfo, setRunInfo] = useState<OcclusionAssistRunInfo | null>(null);
  const [isStale, setIsStale] = useState(false);
  const sourceRef = useRef<OcclusionSource | null>(null);
  const labelsByIdRef = useRef<Map<string, OcclusionLabelCandidate>>(new Map());
  const runTaskFn = options?.runTaskFn ?? runTask;
  const ocrFn = options?.ocrFn ?? ocrImageLabelsForOcclusion;

  const busy =
    status.kind === "ocr-running" || status.kind === "ai-running";

  /** OCR box for a label id — the only geometry source (never the model). */
  const labelBoxAsRegion = useCallback((labelId: string): ImageOcclusionRegion | null => {
    const label = labelsByIdRef.current.get(labelId);
    if (!label) return null;
    return {
      id: label.id,
      x: label.x,
      y: label.y,
      width: label.width,
      height: label.height,
      label: label.text,
    };
  }, []);

  const run = useCallback(async () => {
    if (!asset || busy) return;
    setStatus({ kind: "ocr-running" });
    setProposals(null);
    setOcrMeta(null);
    setRunInfo(null);
    setIsStale(false);

    let source: OcclusionSource;
    try {
      source = occlusionSourceFromAsset(asset);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : undefined,
      });
      return;
    }

    let labels: OcclusionLabelCandidate[];
    let backend: "android-mlkit" | "rust-ocr";
    try {
      const ocr = await ocrFn(source.imageBase64, { maxResults: 32 });
      backend = ocr.backend;
      labels = ocr.labels.map((label) => ({
        id: label.id,
        text: label.text,
        x: label.x,
        y: label.y,
        width: label.width,
        height: label.height,
        confidence: label.confidence,
      }));
    } catch (error) {
      // OCR failure: surface it, keep manual authoring untouched (spec).
      setStatus({
        kind: "error",
        category: "OCRFailed",
        message: error instanceof Error ? error.message : undefined,
      });
      return;
    }

    const filtered = filterOcclusionLabels(labels);
    setOcrMeta({
      detected: labels.length,
      kept: filtered.kept.length,
      droppedTiny: filtered.droppedTiny,
      droppedShortText: filtered.droppedShortText,
      droppedDense: filtered.droppedDense,
      backend,
    });

    sourceRef.current = source;
    labelsByIdRef.current = new Map(
      (filtered.kept.length > 0 ? filtered.kept : labels).map((label) => [label.id, label])
    );

    const fingerprint = await sha256SourceFingerprint(source);

    if (filtered.kept.length === 0) {
      if (options?.freeformEnabled) {
        // Experimental path: only offered when OCR found nothing (task 3.8).
        setStatus({ kind: "ai-running" });
        try {
          const result = await runTaskFn(occlusionFreeformTask, { source }, { targetId: asset.id });
          const timestamp = Date.now();
          const suggestions: ImageOcclusionRegion[] = result.output.regions.map((region, index) => ({
            ...region,
            id: `freeform-${timestamp}-${index}`,
          }));
          session.apply({ type: "replaceSuggestions", suggestions });
          setProposals({
            appropriate: suggestions.length > 0,
            cards: [],
            rejected: [],
            usedFreeform: true,
          });
          setRunInfo({
            taskId: occlusionFreeformTask.id,
            providerId: result.providerId,
            providerKind: result.providerKind,
            servedModelClass: result.servedModelClass,
            baseModelName: result.baseModelName,
            fingerprint,
          });
          setStatus(suggestions.length > 0 ? { kind: "ready" } : { kind: "no-labels" });
        } catch (error) {
          setStatus(errorStatus(error));
        }
        return;
      }
      setStatus({ kind: "no-labels" });
      return;
    }

    setStatus({ kind: "ai-running" });
    try {
      const result = await runTaskFn(
        occlusionLabelSelectionTask,
        {
          source,
          labels: filtered.kept,
          documentContext: asset.file_name
            ? { documentTitle: asset.file_name }
            : undefined,
        },
        { targetId: asset.id }
      );
      const selection = result.output;
      const timestamp = Date.now();
      setProposals({
        appropriate: selection.appropriate,
        cards: selection.selections.map((entry, index) => ({
          id: `assist-${timestamp}-${index}`,
          labelIds: [...entry.labelIds],
          question: entry.question,
          answer: entry.answer,
          accepted: false,
        })),
        rejected: selection.rejected.map((rejection) => ({
          labelId: rejection.labelId,
          text: labelsByIdRef.current.get(rejection.labelId)?.text,
          reason: rejection.reason,
        })),
        usedFreeform: false,
      });
      setRunInfo({
        taskId: occlusionLabelSelectionTask.id,
        providerId: result.providerId,
        providerKind: result.providerKind,
        servedModelClass: result.servedModelClass,
        baseModelName: result.baseModelName,
        fingerprint,
      });
      setStatus(
        selection.appropriate && selection.selections.length > 0
          ? { kind: "ready" }
          : { kind: "inappropriate" }
      );
    } catch (error) {
      setStatus(errorStatus(error));
    }
  }, [asset, busy, options?.freeformEnabled, runTaskFn, ocrFn, session]);

  /** Re-verify the source fingerprint; marks proposals stale on mismatch. */
  const checkStale = useCallback(async (): Promise<boolean> => {
    const source = sourceRef.current;
    if (!source || !runInfo) return false;
    try {
      const current = await sha256SourceFingerprint(source);
      const stale = current !== runInfo.fingerprint;
      setIsStale(stale);
      return stale;
    } catch {
      return false;
    }
  }, [runInfo]);

  const toggleCard = useCallback((cardId: string) => {
    setProposals((current) =>
      current
        ? {
            ...current,
            cards: current.cards.map((card) =>
              card.id === cardId ? { ...card, accepted: !card.accepted } : card
            ),
          }
        : current
    );
  }, []);

  const setAcceptAll = useCallback((accepted: boolean) => {
    setProposals((current) =>
      current
        ? { ...current, cards: current.cards.map((card) => ({ ...card, accepted })) }
        : current
    );
  }, []);

  const editCard = useCallback(
    (cardId: string, patch: { question?: string; answer?: string }) => {
      setProposals((current) =>
        current
          ? {
              ...current,
              cards: current.cards.map((card) =>
                card.id === cardId ? { ...card, ...patch } : card
              ),
            }
          : current
      );
    },
    []
  );

  /**
   * Land the accepted cards' label boxes as editable regions (one history
   * entry). Region ids equal OCR label ids, so later drag/resize edits in the
   * canvas are picked up at save time. Freeform sessions already landed their
   * regions as suggestions.
   */
  const applyAcceptedCardsToSession = useCallback((): OcclusionAssistCard[] => {
    if (!proposals || proposals.usedFreeform) return [];
    const accepted = proposals.cards.filter((card) => card.accepted);
    if (accepted.length === 0) return [];
    const existing = new Set(session.regions.map((region) => region.id ?? ""));
    const additions: ImageOcclusionRegion[] = [];
    for (const card of accepted) {
      for (const labelId of card.labelIds) {
        if (existing.has(labelId)) continue;
        const region = labelBoxAsRegion(labelId);
        if (region) {
          additions.push(region);
          existing.add(labelId);
        }
      }
    }
    if (additions.length > 0) {
      session.apply({
        type: "replaceRegions",
        regions: [...session.regions, ...additions],
      });
    }
    return accepted;
  }, [proposals, session, labelBoxAsRegion]);

  const acceptedCards = useMemo(
    () => (proposals ? proposals.cards.filter((card) => card.accepted) : []),
    [proposals]
  );

  return {
    status,
    busy,
    proposals,
    ocrMeta,
    runInfo,
    isStale,
    run,
    checkStale,
    toggleCard,
    setAcceptAll,
    editCard,
    applyAcceptedCardsToSession,
    acceptedCards,
    labelBoxAsRegion,
  };
}

function errorStatus(error: unknown): OcclusionAssistStatus {
  if (error instanceof AIError) {
    return { kind: "error", message: error.message, category: error.category };
  }
  return {
    kind: "error",
    message: error instanceof Error ? error.message : undefined,
  };
}
