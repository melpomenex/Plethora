/**
 * Flashcard source provenance envelope.
 *
 * Stored (JSON-serialized) on `learning_items.source_reference` for cards
 * created WITHOUT an extract. Cards linked to an extract anchor through
 * `extracts.selection_context` instead — the two paths are mutually
 * exclusive by construction (the create commands ignore the reference when
 * `extract_id` is present).
 *
 * The locator reuses the application's existing jump format
 * (`ExactSearchHitLocation`) so resolution can feed it straight into
 * `openDocumentAtLocation`; nothing here invents a new locator shape.
 */

import type { ExactSearchHitLocation } from "./searchHit";

export interface CardSourceReference {
  /** Envelope version — validation refuses anything but 1. */
  version: 1;
  document_id: string;
  /** Locator in the existing document-jump format. */
  locator: ExactSearchHitLocation;
  /** Exact originating quote, ≤300 chars (same bound as selection passages). */
  excerpt: string;
  /** Human-readable origin, e.g. "Chapter 4 · Memory Systems". */
  section_label?: string;
  /** Fingerprint of the source text at capture time (staleness detection). */
  fingerprint?: string;
  /** Capture timestamp (ISO 8601). */
  captured_at?: string;
}

/** Maximum stored excerpt length, mirroring `passageAroundSelection`. */
export const CARD_SOURCE_EXCERPT_MAX_CHARS = 300;

const KNOWN_LOCATOR_KINDS = new Set([
  "pdf",
  "epub",
  "html",
  "markdown",
  "youtube",
  "audio",
]);

/**
 * Parse and validate a stored `source_reference` string. Returns null for
 * anything malformed — corrupt provenance is treated as absent (it must
 * never break card rendering or review), per the spec.
 */
export function parseCardSourceReference(
  raw: string | null | undefined
): CardSourceReference | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const ref = value as Record<string, unknown>;

  if (ref.version !== 1) return null;
  if (typeof ref.document_id !== "string" || ref.document_id.length === 0) {
    return null;
  }
  const locator = ref.locator as Record<string, unknown> | null | undefined;
  if (
    typeof locator !== "object" ||
    locator === null ||
    typeof locator.kind !== "string" ||
    !KNOWN_LOCATOR_KINDS.has(locator.kind)
  ) {
    return null;
  }
  if (typeof ref.excerpt !== "string" || ref.excerpt.length === 0) return null;

  return {
    version: 1,
    document_id: ref.document_id,
    locator: locator as unknown as ExactSearchHitLocation,
    excerpt: ref.excerpt,
    section_label:
      typeof ref.section_label === "string" ? ref.section_label : undefined,
    fingerprint: typeof ref.fingerprint === "string" ? ref.fingerprint : undefined,
    captured_at: typeof ref.captured_at === "string" ? ref.captured_at : undefined,
  };
}

/** Serialize an envelope for storage. Excerpt is clamped defensively. */
export function serializeCardSourceReference(
  ref: Omit<CardSourceReference, "version"> & { version?: 1 }
): string {
  return JSON.stringify({
    ...ref,
    version: 1,
    excerpt: ref.excerpt.slice(0, CARD_SOURCE_EXCERPT_MAX_CHARS),
  });
}
