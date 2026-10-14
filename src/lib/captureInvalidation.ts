import type { CaptureListingSource } from "../api/capture-activity";

export const CAPTURE_INVALIDATION_EVENT = "plethora:capture-invalidated";

export interface CaptureInvalidation {
  source: CaptureListingSource;
  documentIds: string[];
}

export function emitCaptureInvalidation(detail: CaptureInvalidation): void {
  if (typeof window === "undefined" || detail.documentIds.length === 0) return;
  window.dispatchEvent(new CustomEvent<CaptureInvalidation>(CAPTURE_INVALIDATION_EVENT, { detail }));
}
