/**
 * Unified Priority Commit Service
 *
 * Provides typed backend dispatch and draft/commit/deduplication lifecycle
 * for setting priority across keyboard, pointer, and touch inputs.
 *
 * Complies with R08:
 * - Authoritative 0-100 continuous slider
 * - Canonical derived rating (0-5, with 0 mapping to rating 0)
 * - Explicit zero persistence (priorityExplicitlySet = true)
 * - Single commit per intent with deduplication
 * - Retains draft on failure for retry with error reporting
 * - Late completion identity guard (cannot overwrite newer item or other control)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bulkSetDocumentPriority,
  updateDocumentPriority,
} from "../../api/documents";
import { updateLearningItemPriority } from "../../api/learning-items";
import { setExtractPriority } from "../../api/extracts";
import type { Document } from "../../types/document";
import type { LearningItem } from "../../api/learning-items";
import type { BulkOperationResult } from "../../api/extract-bulk";
import type { QueuePriorityTarget } from "../../api/queue";
import type { QueueItem } from "../../types/queue";

export type PriorityTarget =
  | { kind: "document"; id: string }
  | { kind: "extract"; id: string }
  | { kind: "learningItem"; id: string }
  | { kind: "documents"; ids: string[] };

export interface PriorityCommitResult {
  target: PriorityTarget;
  slider: number;
  rating?: number;
  document?: Document;
  learningItem?: LearningItem;
  bulkResult?: BulkOperationResult;
}

/** Resolve the displayed queue row to its own persistent entity. */
export function resolveQueuePriorityTarget(item: QueueItem): QueuePriorityTarget | null {
  switch (item.itemType) {
    case "document": return { kind: "document", id: item.documentId || item.id };
    case "playlist-video": return item.documentId ? { kind: "document", id: item.documentId } : null;
    case "extract": return { kind: "extract", id: item.extractId || item.id };
    case "learning-item": return { kind: "learning-item", id: item.learningItemId || item.id };
    case "rss-article": return { kind: "rss-article", id: item.entityId || (item.id.startsWith("rss-") ? item.id.slice(4) : item.id) };
    case "video-extract": return { kind: "video-extract", id: item.entityId || item.id };
    default: return null;
  }
}

// Priority presets with labels, description keys, and standard colors
export const PRIORITY_PRESETS = [
  { value: 10, labelKey: "priority.lowest", descKey: "priority.lowestDesc", color: "#6B7280" },
  { value: 30, labelKey: "priority.low", descKey: "priority.lowDesc", color: "#9CA3AF" },
  { value: 50, labelKey: "priority.normal", descKey: "priority.normalDesc", color: "#3B82F6" },
  { value: 70, labelKey: "priority.high", descKey: "priority.highDesc", color: "#F59E0B" },
  { value: 90, labelKey: "priority.highest", descKey: "priority.highestDesc", color: "#EF4444" },
] as const;

export function getPriorityPreset(slider: number) {
  if (slider >= 81) return PRIORITY_PRESETS[4];
  if (slider >= 61) return PRIORITY_PRESETS[3];
  if (slider >= 41) return PRIORITY_PRESETS[2];
  if (slider >= 21) return PRIORITY_PRESETS[1];
  return PRIORITY_PRESETS[0];
}

export const getPriorityInfo = getPriorityPreset;

/**
 * Derive 0-5 rating from continuous 0-100 slider.
 * Matches Rust algorithms::rating_from_slider exactly: 0 maps to 0.
 */
export function sliderToRating(slider: number): number {
  const clamped = Math.max(0, Math.min(100, Math.round(slider)));
  if (clamped >= 81) return 5;
  if (clamped >= 61) return 4;
  if (clamped >= 41) return 3;
  if (clamped >= 21) return 2;
  if (clamped > 0) return 1;
  return 0;
}

/**
 * Resolve display slider, honoring explicit zero.
 */
export function resolveDisplaySlider(doc: {
  prioritySlider?: number;
  priorityRating?: number;
  priorityExplicitlySet?: boolean;
}): number {
  if (doc.priorityExplicitlySet) {
    return Math.max(0, Math.min(100, doc.prioritySlider ?? 0));
  }
  if ((doc.prioritySlider ?? 0) > 0) return doc.prioritySlider!;
  const rating = doc.priorityRating ?? 0;
  if (rating > 0) {
    return ([0, 10, 30, 50, 70, 90] as const)[Math.min(5, Math.max(0, rating))];
  }
  return 50;
}

/** Legacy extract keys only identify inheritance when they match the parent. */
export function resolveExtractDisplaySlider(
  extract: { priority_slider?: number | null; priority_score?: number },
  parent?: { priorityScore?: number; prioritySlider?: number; priorityRating?: number; priorityExplicitlySet?: boolean },
): number {
  if (extract.priority_slider != null) return Math.max(0, Math.min(100, extract.priority_slider));
  if (parent && Math.abs((extract.priority_score ?? 0) - (parent.priorityScore ?? 0)) < 0.001) {
    return resolveDisplaySlider(parent);
  }
  return 50;
}

/**
 * Authoritative 0–100 readback for a queue row.
 *
 * Prefers the backend's resolved display slider (which includes inherited
 * extract values), then falls back to the row's own explicit fields so older
 * rows and browser-backed queues still render a committed zero or slider.
 */
export function resolveQueueItemDisplaySlider(item: {
  itemType: string;
  priorityDisplaySlider?: number;
  prioritySlider?: number;
  priorityRating?: number;
  priorityExplicitlySet?: boolean;
}): number {
  if (typeof item.priorityDisplaySlider === "number" && Number.isFinite(item.priorityDisplaySlider)) {
    return Math.max(0, Math.min(100, Math.round(item.priorityDisplaySlider)));
  }
  if (item.itemType === "extract") {
    return item.prioritySlider != null
      ? Math.max(0, Math.min(100, Math.round(item.prioritySlider)))
      : 50;
  }
  return resolveDisplaySlider({
    prioritySlider: item.prioritySlider,
    priorityRating: item.priorityRating,
    priorityExplicitlySet:
      item.priorityExplicitlySet ?? (item.itemType === "learning-item" && item.prioritySlider != null),
  });
}

/**
 * Dispatch typed backend priority persistence.
 */
export async function dispatchPriorityCommit(
  target: PriorityTarget,
  slider: number,
): Promise<PriorityCommitResult> {
  const normalizedSlider = Math.max(0, Math.min(100, Math.round(slider)));
  const rating = sliderToRating(normalizedSlider);

  if (target.kind === "document") {
    const updated = await updateDocumentPriority(target.id, rating, normalizedSlider);
    return {
      target,
      slider: normalizedSlider,
      rating: updated.priorityRating ?? rating,
      document: updated,
    };
  }

  if (target.kind === "extract") {
    await setExtractPriority(target.id, normalizedSlider);
    return {
      target,
      slider: normalizedSlider,
      rating,
    };
  }

  if (target.kind === "learningItem") {
    const updated = await updateLearningItemPriority(target.id, normalizedSlider);
    return {
      target,
      slider: normalizedSlider,
      rating,
      learningItem: updated,
    };
  }

  if (target.kind === "documents") {
    if (target.ids.length === 1) {
      const updated = await updateDocumentPriority(target.ids[0], rating, normalizedSlider);
      return {
        target,
        slider: normalizedSlider,
        rating: updated.priorityRating ?? rating,
        document: updated,
        bulkResult: { succeeded: [target.ids[0]], failed: [], errors: [] },
      };
    }
    const bulkResult = await bulkSetDocumentPriority(target.ids, normalizedSlider);
    return {
      target,
      slider: normalizedSlider,
      rating,
      bulkResult,
    };
  }

  throw new Error(`Unsupported priority target kind: ${(target as any)?.kind}`);
}

export interface UsePriorityCommitStateOptions {
  target?: PriorityTarget;
  initialValue: number;
  onCommitted?: (result: PriorityCommitResult) => void;
  onError?: (error: unknown, target: PriorityTarget | undefined, attemptedValue: number) => void;
  customCommit?: (slider: number) => Promise<void> | void;
}

/**
 * Reusable draft, deduplication, and completion hook for priority controls.
 * Captures gestures across mouse, keyboard, and touch.
 */
export function usePriorityCommitState({
  target,
  initialValue,
  onCommitted,
  onError,
  customCommit,
}: UsePriorityCommitStateOptions) {
  const [slider, setSlider] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const committed = useRef(initialValue);
  const pending = useRef(false);
  const mounted = useRef(false);
  const gestureStart = useRef(initialValue);
  const gestureCancelled = useRef(false);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    committed.current = initialValue;
    if (!pending.current) {
      setSlider(initialValue);
      setSaveFailed(false);
      setErrorMessage(null);
    }
  }, [initialValue, target?.kind, target && "id" in target ? target.id : undefined]);

  const commitPriority = useCallback(
    async (nextValue?: number, closeAfterSave?: () => void) => {
      if (pending.current) return;
      const normalized = Math.max(
        0,
        Math.min(100, Math.round(nextValue !== undefined ? nextValue : slider)),
      );
      setSlider(normalized);

      if (normalized === committed.current && !saveFailed) {
        closeAfterSave?.();
        return;
      }

      const capturedTarget = targetRef.current;
      pending.current = true;
      setIsSaving(true);
      setSaveFailed(false);
      setErrorMessage(null);

      try {
        let result: PriorityCommitResult | undefined;
        if (customCommit) {
          await customCommit(normalized);
        } else if (capturedTarget) {
          result = await dispatchPriorityCommit(capturedTarget, normalized);
        }
        if (!mounted.current) return;

        // Verify target identity hasn't changed during async call
        const currentTarget = targetRef.current;
        const targetChanged =
          Boolean(capturedTarget && currentTarget) &&
          (capturedTarget?.kind !== currentTarget?.kind ||
            (capturedTarget && "id" in capturedTarget && currentTarget && "id" in currentTarget
              ? capturedTarget.id !== currentTarget.id
              : false));

        if (!targetChanged) {
          committed.current = normalized;
          if (result) onCommitted?.(result);
          closeAfterSave?.();
        }
      } catch (error) {
        if (!mounted.current) return;
        const currentTarget = targetRef.current;
        const targetChanged =
          Boolean(capturedTarget && currentTarget) &&
          (capturedTarget?.kind !== currentTarget?.kind ||
            (capturedTarget && "id" in capturedTarget && currentTarget && "id" in currentTarget
              ? capturedTarget.id !== currentTarget.id
              : false));

        if (!targetChanged) {
          setSaveFailed(true);
          setErrorMessage(error instanceof Error ? error.message : String(error));
          onError?.(error, capturedTarget, normalized);
          // Retain failed draft in slider for retry
        }
      } finally {
        pending.current = false;
        if (mounted.current) setIsSaving(false);
      }
    },
    [slider, saveFailed, customCommit, onCommitted, onError],
  );

  const cancelDraft = useCallback(() => {
    setSlider(committed.current);
    setSaveFailed(false);
    setErrorMessage(null);
  }, []);

  const sliderHandlers = useMemo(
    () => ({
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        if (pending.current) {
          event.currentTarget.value = String(slider);
          return;
        }
        setSaveFailed(false);
        setErrorMessage(null);
        setSlider(Number(event.target.value));
      },
      onPointerDown: (event: React.PointerEvent<HTMLInputElement>) => {
        if (pending.current) {
          event.preventDefault();
          return;
        }
        gestureStart.current = slider;
        gestureCancelled.current = false;
      },
      onPointerCancel: () => {
        gestureCancelled.current = true;
        setSlider(gestureStart.current);
      },
      onTouchCancel: () => {
        gestureCancelled.current = true;
        setSlider(gestureStart.current);
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (pending.current && event.key !== "Tab") {
          event.preventDefault();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void commitPriority(Number(event.currentTarget.value));
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelDraft();
        }
      },
      onPointerUp: (event: React.PointerEvent<HTMLInputElement>) => {
        if (!gestureCancelled.current) {
          void commitPriority(Number(event.currentTarget.value));
        }
      },
      onTouchEnd: (event: React.TouchEvent<HTMLInputElement>) => {
        if (!gestureCancelled.current) {
          void commitPriority(Number(event.currentTarget.value));
        }
      },
      onKeyUp: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key)
        ) {
          void commitPriority(Number(event.currentTarget.value));
        }
      },
      onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
        void commitPriority(Number(event.currentTarget.value));
      },
    }),
    [slider, commitPriority, cancelDraft],
  );

  return {
    slider,
    setSlider,
    isSaving,
    saveFailed,
    errorMessage,
    committedValue: committed.current,
    commitPriority,
    cancelDraft,
    sliderHandlers,
  };
}
