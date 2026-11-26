/**
 * DEPRECATED: Pre-computed alignment does not work — valid CFIs require rendered DOM content.
 * Sync is now handled at runtime via DOM-based matching in EPUBViewer + epubSync.ts.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { AlignmentResult, AlignmentWorkerInput, AlignmentWorkerOutput } from "../types/alignment";
import { cacheAlignment, getCachedAlignment } from "../api/alignmentCache";
import { alignmentsFromWorkerResult, bridgeAlignmentToLanguageStore } from "../lib/languageAudioAlignment";
import { useSettingsStore } from "../stores/settingsStore";
import { useLanguageProfileStore } from "../stores/languageProfileStore";

export type AlignmentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "aligning"; progress: number }
  | { status: "ready"; result: AlignmentResult }
  | { status: "error"; message: string };

async function syncWorkerAlignmentToLanguageLayer(result: AlignmentResult): Promise<void> {
  try {
    const languageLearningEnabled = useSettingsStore.getState().settings.languageLearning?.enabled === true;
    let profileId: string | undefined;
    if (languageLearningEnabled) {
      const profileStore = useLanguageProfileStore.getState();
      const resolved = await profileStore.resolveContext("document", result.epubDocId).catch(() => null);
      profileId = resolved?.profile.id ?? profileStore.activeProfileId ?? undefined;
    }
    const alignments = alignmentsFromWorkerResult(result, { profileId });
    await bridgeAlignmentToLanguageStore({
      alignments,
      mediaFingerprint: result.audioDocId,
      profileId,
      persist: languageLearningEnabled && Boolean(profileId),
    });
  } catch {
    // Language layer bridging is best-effort and must never disrupt reader alignment.
  }
}

export function useAlignment(
  audioDocId: string | null,
  epubDocId: string | null,
  inputData: AlignmentWorkerInput | null
) {
  const [state, setState] = useState<AlignmentState>({ status: "idle" });
  const workerRef = useRef<Worker | null>(null);

  const runAlignment = useCallback(async () => {
    if (!audioDocId || !epubDocId || !inputData) {
      setState({ status: "idle" });
      return;
    }

    if (inputData.transcriptSegments.length === 0) {
      setState({ status: "error", message: "No transcript available. Transcribe the audiobook first." });
      return;
    }

    setState({ status: "loading" });

    try {
      const cached = await getCachedAlignment(audioDocId, epubDocId);
      if (cached) {
        void syncWorkerAlignmentToLanguageLayer(cached);
        setState({ status: "ready", result: cached });
        return;
      }

      setState({ status: "aligning", progress: 0 });

      const worker = new Worker(
        new URL("../workers/alignment.worker.ts", import.meta.url),
        { type: "module" }
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent<AlignmentWorkerOutput>) => {
        const output = e.data;
        const result: AlignmentResult = {
          audioDocId,
          epubDocId,
          chapterMatches: output.chapterMatches,
          segmentMappings: output.segmentMappings,
          matchRate: output.matchRate,
          totalSegments: output.totalSegments,
          matchedSegments: output.matchedSegments,
          createdAt: new Date().toISOString(),
        };

        cacheAlignment(result).catch(() => {});
        void syncWorkerAlignmentToLanguageLayer(result);
        setState({ status: "ready", result });
        worker.terminate();
        workerRef.current = null;
      };

      worker.onerror = (err) => {
        setState({ status: "error", message: err.message || "Alignment failed" });
        worker.terminate();
        workerRef.current = null;
      };

      worker.postMessage(inputData);
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Alignment failed",
      });
    }
  }, [audioDocId, epubDocId, inputData]);

  useEffect(() => {
    runAlignment();
  }, [runAlignment]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  return { state, retry: runAlignment };
}
