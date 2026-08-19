/**
 * Legacy Audiobook to Audio Edition Migration
 * 
 * Idempotently scans existing localStorage `audiobook-*` entries and audio documents,
 * converting them into canonical AudioEdition manifests and sections.
 */

import { getDocuments } from "../api/documents";
import {
  createAudioEdition,
  getAudioEditionByDocument,
  saveAudioEditionAnchors,
} from "../api/audioEditions";
import type { AudioEdition, AudioEditionSection, AudioEditionAnchor } from "../types/audioEdition";

const MIGRATION_FLAG_KEY = "audio-edition-legacy-migration-completed";

export async function runLegacyAudiobookMigration(force = false): Promise<{
  migratedCount: number;
  skippedCount: number;
}> {
  if (typeof window === "undefined" || !window.localStorage) {
    return { migratedCount: 0, skippedCount: 0 };
  }

  if (!force && window.localStorage.getItem(MIGRATION_FLAG_KEY)) {
    return { migratedCount: 0, skippedCount: 0 };
  }

  let migratedCount = 0;
  let skippedCount = 0;

  try {
    // 1. Gather all documents that are audio files or have audiobook-* localStorage entries
    const docs = await getDocuments().catch(() => [] as any[]);
    const docMap = new Map<string, any>();
    docs.forEach((d: any) => {
      if (d && d.id) docMap.set(d.id, d);
    });

    // Find all localStorage keys starting with audiobook- (excluding summary/stats keys)
    const legacyKeys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (
        key &&
        key.startsWith("audiobook-") &&
        !key.includes("stats") &&
        !key.includes("dnf") &&
        !key.includes("volume") &&
        !key.includes("rate") &&
        !key.includes("bookmarks") &&
        !key.includes("migration")
      ) {
        legacyKeys.push(key);
      }
    }

    // Process localStorage entries
    for (const key of legacyKeys) {
      const docId = key.replace("audiobook-", "");
      const existing = await getAudioEditionByDocument(docId).catch(() => null);
      if (existing) {
        skippedCount++;
        continue;
      }

      const raw = window.localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        const doc = docMap.get(docId);
        const title = parsed.metadata?.title || doc?.title || "Audiobook";
        const duration = parsed.metadata?.duration || 0;
        const filePath = doc?.filePath || "";

        const sections: AudioEditionSection[] = [];
        const editionId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        if (Array.isArray(parsed.chapters) && parsed.chapters.length > 0) {
          parsed.chapters.forEach((ch: any, idx: number) => {
            const secId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sec-${Date.now()}-${idx}`;
            sections.push({
              id: secId,
              editionId,
              sectionIndex: idx,
              title: ch.title || `Chapter ${idx + 1}`,
              characterCount: 0,
              audioFilePath: filePath,
              audioMimeType: "audio/mp3",
              durationSec: ch.duration || (ch.endTime && ch.startTime ? ch.endTime - ch.startTime : 0),
              generationStatus: "ready",
              retryCount: 0,
              cacheKey: `legacy-${docId}-${idx}`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          });
        } else {
          // Single default section
          const secId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sec-${Date.now()}-0`;
          sections.push({
            id: secId,
            editionId,
            sectionIndex: 0,
            title,
            characterCount: 0,
            audioFilePath: filePath,
            audioMimeType: "audio/mp3",
            durationSec: duration,
            generationStatus: "ready",
            retryCount: 0,
            cacheKey: `legacy-${docId}-0`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        const edition: AudioEdition = {
          id: editionId,
          sourceDocumentId: docId,
          sourceRevisionHash: "legacy-v1",
          provider: "legacy",
          model: "standalone",
          voice: parsed.metadata?.narrator || "default",
          qualityPreset: "natural",
          totalDurationSec: duration,
          status: "ready",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sections,
        };

        await createAudioEdition(edition, sections);

        // Convert transcript segments to anchors if available
        if (parsed.transcript?.segments && Array.isArray(parsed.transcript.segments)) {
          const primarySecId = sections[0].id;
          const anchors: AudioEditionAnchor[] = parsed.transcript.segments.map((seg: any) => ({
            id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `anc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            sectionId: primarySecId,
            audioStartSec: seg.startTime || 0,
            audioEndSec: seg.endTime || 0,
            sourceStartAnchor: String(seg.startTime || 0),
            sourceEndAnchor: String(seg.endTime || 0),
            textContent: seg.text || "",
          }));

          if (anchors.length > 0) {
            await saveAudioEditionAnchors(primarySecId, anchors).catch(() => {});
          }
        }

        migratedCount++;
      } catch (err) {
        console.warn(`Failed to migrate legacy audiobook record ${key}:`, err);
      }
    }

    // Set completion flag
    window.localStorage.setItem(MIGRATION_FLAG_KEY, new Date().toISOString());
  } catch (e) {
    console.error("Audio edition legacy migration error:", e);
  }

  return { migratedCount, skippedCount };
}
