/**
 * useToastExtract - Instant extract creation with toast feedback.
 *
 * Creates an extract immediately (no dialog), flashes the selection,
 * and shows a success toast with an "Edit" action button.
 */

import { createFeedbackInteractionId, emitUserInteraction } from "../lib/feedback/orchestrator";
import { useCallback, useEffect, useRef, useState } from "react";
import { createExtract, CreateExtractInput, Extract } from "../api/extracts";
import { useToast } from "../components/common/Toast";
import { useExtractStore } from "../stores/extractStore";
import { handleAutoGeneration, handleAutoSummarization } from "../utils/aiExtractUtils";
import { dispatchPriorityCommit } from "../services/priority/priorityCommit";
import { isEditableEventTarget } from "../components/queue/EndOfItemTriageBar";

export const PRIORITY_NUDGE_STEP = 5;
export const PRIORITY_NUDGE_WINDOW_MS = 4000;

export function clampPrioritySlider(slider: number): number {
  return Math.max(1, Math.min(100, Math.round(slider)));
}

export interface ExtractPriorityNudgeWindow {
  extractId: string;
  prioritySlider: number;
  expiresAt: number;
}

interface UseToastExtractOptions {
  onEditExtract?: (extract: Extract) => void;
}

export function useToastExtract(options?: UseToastExtractOptions) {
  const toast = useToast();
  const { lastHighlightColor, setLastHighlightColor, loadExtracts } = useExtractStore();
  const pendingRef = useRef<Set<string>>(new Set());
  const [nudgeWindow, setNudgeWindow] = useState<ExtractPriorityNudgeWindow | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleNudgeExpiry = useCallback(() => {
    if (nudgeTimerRef.current) {
      clearTimeout(nudgeTimerRef.current);
    }
    nudgeTimerRef.current = setTimeout(() => {
      setNudgeWindow(null);
      nudgeTimerRef.current = null;
    }, PRIORITY_NUDGE_WINDOW_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (nudgeTimerRef.current) {
        clearTimeout(nudgeTimerRef.current);
      }
    };
  }, []);

  const nudgeExtractPriority = useCallback(
    async (delta: number) => {
      if (!nudgeWindow) return null;
      const nextSlider = clampPrioritySlider(nudgeWindow.prioritySlider + delta);
      const nextWindow: ExtractPriorityNudgeWindow = {
        extractId: nudgeWindow.extractId,
        prioritySlider: nextSlider,
        expiresAt: Date.now() + PRIORITY_NUDGE_WINDOW_MS,
      };
      setNudgeWindow(nextWindow);
      scheduleNudgeExpiry();

      try {
        await dispatchPriorityCommit({ kind: "extract", id: nudgeWindow.extractId }, nextSlider);
        const pctLabel = delta < 0 ? `-${Math.abs(delta)}%` : `+${Math.abs(delta)}%`;
        toast.success(`Priority ${nextSlider} (${pctLabel})`);
      } catch (error) {
        console.error("Failed to nudge extract priority:", error);
      }
      return nextSlider;
    },
    [nudgeWindow, scheduleNudgeExpiry, toast]
  );

  useEffect(() => {
    if (!nudgeWindow) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableEventTarget(e.target) || isEditableEventTarget(document.activeElement)) {
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        void nudgeExtractPriority(-PRIORITY_NUDGE_STEP);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        void nudgeExtractPriority(PRIORITY_NUDGE_STEP);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nudgeWindow, nudgeExtractPriority]);

  const createInstantExtract = useCallback(
    async (params: {
      documentId: string;
      text: string;
      color?: string;
      pageNumber?: number;
      selectionContext?: unknown;
      note?: string;
      parentPrioritySlider?: number;
    }): Promise<Extract | null> => {
      const { documentId, text, color, pageNumber, selectionContext, note, parentPrioritySlider } = params;

      const trimmedText = text.trim();
      if (!trimmedText || trimmedText.length < 3) return null;

      const dedupeKey = `${documentId}::${pageNumber ?? ""}::${trimmedText}`;
      if (pendingRef.current.has(dedupeKey)) return null;
      pendingRef.current.add(dedupeKey);

      const interactionId = createFeedbackInteractionId();
      const extractColor = color || lastHighlightColor;

      try {
        const input: CreateExtractInput = {
          document_id: documentId,
          content: trimmedText,
          color: extractColor,
          page_number: pageNumber,
          selection_context: selectionContext as CreateExtractInput["selection_context"],
          note: note,
        };

        const extract = await createExtract(input);
        emitUserInteraction("reader.annotation-saved", interactionId);
        setLastHighlightColor(extractColor);
        await loadExtracts(documentId);

        handleAutoGeneration(extract.id, extract.content).catch((err) =>
          console.error("Auto-generation failed:", err)
        );
        handleAutoSummarization(extract.content).then((summary) => {
          if (summary) {
          }
        }).catch((err) =>
          console.error("Auto-summarization failed:", err)
        );

        const initialSlider = clampPrioritySlider(
          extract.priority_slider ?? parentPrioritySlider ?? 50
        );
        setNudgeWindow({
          extractId: extract.id,
          prioritySlider: initialSlider,
          expiresAt: Date.now() + PRIORITY_NUDGE_WINDOW_MS,
        });
        scheduleNudgeExpiry();

        toast.success("Highlight saved", `Priority ${initialSlider} • ↑/↓ to adjust`, {
          feedback: { interactionId, origin: "user", hapticHandled: true },
          action: {
            label: "Edit",
            onClick: () => options?.onEditExtract?.(extract),
          },
        });

        return extract;
      } catch (error) {
        emitUserInteraction("action.failed", interactionId);
        console.error("Failed to create extract:", error);
        toast.error("Failed to create highlight", error instanceof Error ? error.message : undefined);
        return null;
      } finally {
        pendingRef.current.delete(dedupeKey);
      }
    },
    [lastHighlightColor, setLastHighlightColor, loadExtracts, scheduleNudgeExpiry, toast, options]
  );

  return { createInstantExtract, nudgeWindow, nudgeExtractPriority };
}
