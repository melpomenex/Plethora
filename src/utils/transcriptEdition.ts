/**
 * Transcript Editions (design Decision 5)
 *
 * File-based audiobooks and podcasts that possess timed transcript data
 * (Whisper/Groq segments or imported transcripts) get a lightweight persisted
 * "transcript edition" — one ready section whose anchors ARE the transcript
 * segments. Hands-free capture then works identically to generated editions,
 * without requiring Audio Edition generation when a quality timed transcript
 * already exists.
 */

import {
  createAudioEdition,
  getAudioEditionByDocument,
  saveAudioEditionAnchors,
} from "../api/audioEditions";
import type { AudioEdition, AudioEditionAnchor } from "../types/audioEdition";

export const TRANSCRIPT_EDITION_PROVIDER = "transcript";

export interface TranscriptSegmentInput {
  start: number;
  end: number;
  text: string;
}

function newId(prefix: string): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Return (creating once, idempotently) a transcript-backed edition for a
 * document. The section's `audioFilePath` points at the document's own audio
 * file so the player treats it like any other source.
 */
export async function ensureTranscriptEdition(params: {
  documentId: string;
  title: string;
  durationSec: number;
  segments: TranscriptSegmentInput[];
  audioFilePath?: string | null;
}): Promise<AudioEdition | null> {
  const { documentId, title, durationSec, segments } = params;
  if (!documentId || !Array.isArray(segments) || segments.length === 0) return null;

  try {
    const existing = await getAudioEditionByDocument(documentId);
    if (existing && existing.provider === TRANSCRIPT_EDITION_PROVIDER) {
      return existing;
    }
    // A generated edition takes precedence; never shadow it.
    if (existing) return existing;

    const editionId = newId("ed-tr");
    const sectionId = newId("sec-tr");
    const now = Date.now();

    const anchors: AudioEditionAnchor[] = segments
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text?.trim())
      .map((s, i) => ({
        id: `anc-${sectionId}-${i}`,
        sectionId,
        audioStartSec: s.start,
        audioEndSec: Math.max(s.end, s.start + 0.01),
        // Transcript timestamps double as the "source anchor" — provenance
        // references the audiobook document and timestamp.
        sourceStartAnchor: String(s.start),
        sourceEndAnchor: String(s.end),
        textContent: s.text.trim(),
      }));

    const edition: AudioEdition = {
      id: editionId,
      sourceDocumentId: documentId,
      sourceRevisionHash: "transcript-v1",
      provider: TRANSCRIPT_EDITION_PROVIDER,
      model: "timed-transcript",
      voice: "n/a",
      qualityPreset: null,
      generationSettings: null,
      totalDurationSec: durationSec || 0,
      status: "ready",
      createdAt: now,
      updatedAt: now,
      sections: [
        {
          id: sectionId,
          editionId,
          sectionIndex: 0,
          title,
          sourceSectionId: null,
          sourceStartAnchor: "0",
          sourceEndAnchor: String(durationSec || 0),
          characterCount: anchors.reduce((sum, a) => sum + a.textContent.length, 0),
          audioFilePath: params.audioFilePath ?? null,
          audioMimeType: "audio/mp3",
          durationSec: durationSec || 0,
          generationStatus: "ready",
          failureReason: null,
          retryCount: 0,
          cacheKey: `transcript-${documentId}`,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    await createAudioEdition(edition, edition.sections);
    if (anchors.length > 0) {
      await saveAudioEditionAnchors(sectionId, anchors).catch(() => {});
    }
    return edition;
  } catch (err) {
    console.warn("[transcriptEdition] failed to ensure transcript edition:", err);
    return null;
  }
}
