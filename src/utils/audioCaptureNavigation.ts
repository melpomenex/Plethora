/**
 * "Open in source" navigation for audio captures (design Decision 9) and the
 * deferred Ask-Plethora hand-off (Decision 9 / task 7.5).
 *
 * Provenance stored on an extract's `selection_context` drives the jump:
 * timed-transcript captures land at the audio timestamp; text documents land
 * on an exact-text search for the captured passage.
 */

import type { AudioCaptureProvenance } from "../types/audioEdition";
import type { TabsState } from "../stores/tabsStore";
import type { ExactSearchHitLocation } from "../types/searchHit";
import { openDocumentAtLocation } from "./openDocumentAtLocation";
import { useDocumentStore } from "../stores/documentStore";

/** Distinctive-enough search prefix: the first few words of the passage. */
function textQuoteFor(extractText: string): string {
  const words = extractText.trim().split(/\s+/).slice(0, 12).join(" ");
  return words.length > 0 ? words : extractText.slice(0, 80);
}

/**
 * Open the source document at the location an audio capture refers to.
 * Returns true when a navigation was initiated.
 */
export function openAudioCaptureInSource(
  provenance: AudioCaptureProvenance,
  extractText: string,
  addTab: TabsState["addTab"]
): boolean {
  if (!provenance?.documentId) return false;

  const doc = useDocumentStore
    .getState()
    .documents.find((d) => d.id === provenance.documentId);
  const quote = textQuoteFor(extractText);

  // Timed-transcript captures: the provenance timestamp IS the source location.
  if (provenance.provider === "transcript") {
    const jump: ExactSearchHitLocation = {
      kind: "audio",
      timeSeconds: provenance.audioTimestampSec,
      textQuote: quote || undefined,
    };
    openDocumentAtLocation(provenance.documentId, { initialJump: jump }, addTab);
    return true;
  }

  if (doc?.fileType === "youtube") {
    const jump: ExactSearchHitLocation = {
      kind: "youtube",
      timeSeconds: provenance.audioTimestampSec,
      textQuote: quote || undefined,
    };
    openDocumentAtLocation(provenance.documentId, { initialJump: jump }, addTab);
    return true;
  }

  if (doc?.fileType === "pdf" && extractText) {
    openDocumentAtLocation(
      provenance.documentId,
      { initialJump: { kind: "pdf", pageNumber: 1, textQuote: quote }, highlightQuery: quote },
      addTab
    );
    return true;
  }

  // EPUB / HTML / Markdown / unknown: exact-text search lands at the passage.
  openDocumentAtLocation(
    provenance.documentId,
    extractText ? { highlightQuery: quote } : {},
    addTab
  );
  return true;
}

// ---------------------------------------------------------------------------
// Deferred Ask Plethora (task 7.5): the capture-time marker needs no UI; when
// the user reviews the Inbox and taps "Ask Plethora", the passage is queued
// here and consumed by the document viewer wrapper, which scopes the Document
// Q&A assistant context to the passage.
// ---------------------------------------------------------------------------

const ASK_PLETHORA_QUEUE_KEY = "plethora-ask-passage-queue";

export interface AskPlethoraEntry {
  documentId: string;
  passage: string;
  audioTimestampSec?: number;
  enqueuedAt: number;
}

export function enqueueAskPlethora(entry: Omit<AskPlethoraEntry, "enqueuedAt">): void {
  try {
    const raw = window.sessionStorage.getItem(ASK_PLETHORA_QUEUE_KEY);
    const queue: AskPlethoraEntry[] = raw ? JSON.parse(raw) : [];
    queue.push({ ...entry, enqueuedAt: Date.now() });
    window.sessionStorage.setItem(ASK_PLETHORA_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // sessionStorage unavailable — the hand-off degrades to document open only
  }
}

/** Take the pending Ask-Plethora passage for a document (if any). */
export function consumeAskPlethora(documentId: string): AskPlethoraEntry | null {
  try {
    const raw = window.sessionStorage.getItem(ASK_PLETHORA_QUEUE_KEY);
    if (!raw) return null;
    const queue: AskPlethoraEntry[] = JSON.parse(raw);
    const idx = queue.findIndex((e) => e.documentId === documentId);
    if (idx === -1) return null;
    const [entry] = queue.splice(idx, 1);
    window.sessionStorage.setItem(ASK_PLETHORA_QUEUE_KEY, JSON.stringify(queue));
    return entry ?? null;
  } catch {
    return null;
  }
}
