import type { AlignBookInput, AlignProgress, PlethoraAlignmentMap } from "../lib/ebookAudiobookAlignment/types";
import { alignBook } from "../lib/ebookAudiobookAlignment/alignBook";

export interface AlignmentWorkerRequest {
  type: "align";
  input: AlignBookInput;
  startFromChapter?: number;
  existing?: PlethoraAlignmentMap;
}

export interface AlignmentWorkerResponse {
  type: "progress";
  progress: AlignProgress;
}

export interface AlignmentWorkerComplete {
  type: "complete";
  map: PlethoraAlignmentMap;
}

export interface AlignmentWorkerError {
  type: "error";
  message: string;
}

self.onmessage = (e: MessageEvent<AlignmentWorkerRequest>) => {
  if (e.data.type !== "align") return;
  try {
    const map = alignBook(
      e.data.input,
      (progress) => {
        self.postMessage({ type: "progress", progress } satisfies AlignmentWorkerResponse);
      },
      e.data.startFromChapter ?? 0,
      e.data.existing,
    );
    self.postMessage({ type: "complete", map } satisfies AlignmentWorkerComplete);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "Alignment failed",
    } satisfies AlignmentWorkerError);
  }
};
