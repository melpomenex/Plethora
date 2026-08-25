/**
 * Composed resource-lifetime diagnostic snapshot (task 3.5 / design D13).
 *
 * One structured, JSON-serializable object answering "what does the app
 * itself believe is still alive": owned object URLs by owner, bounded error
 * aggregates, the section-audio cache, TTS in-flight work, edition jobs, the
 * TTS persistent cache, and the TTS IndexedDB connection count. Counts and
 * byte estimates only — no document text, no audio payloads, no URLs to user
 * content, and stacks only inside the bounded error samples.
 *
 * Exposed ONLY through the diagnostics gate consumers (the scenario host's
 * `diagnostics` op); there is no production global. The heavy stores are
 * imported lazily so importing this module stays cheap.
 */

import { getOwnedObjectUrlStats, type OwnedObjectUrlStats } from "./ownedObjectUrl";
import { getErrorAggregates, getErrorRecorderRetainedBytes, type ErrorAggregate } from "./errorRecorder";
import { getTtsCacheConnectionCount, getCacheSize } from "../utils/ttsCache";
import { getTTSInFlightCount } from "../api/tts/dedup";

export interface DiagnosticSnapshot {
  takenAt: number;
  ownedObjectUrls: OwnedObjectUrlStats;
  errorAggregates: ErrorAggregate[];
  errorRecorderBytes: number;
  sectionAudioBlobCache: { entries: number; bytes: number };
  ttsInFlight: number;
  audioEditionJobs: { active: number; total: number };
  ttsCache: { entryCount: number; totalSize: number; maxSize: number };
  ttsCacheConnections: { opened: number; closed: number; live: number };
}

/**
 * Build the snapshot. Async only where a store needs a lazy import or an
 * IDB meta read; every field is a count or byte estimate.
 */
export async function getDiagnosticSnapshot(): Promise<DiagnosticSnapshot> {
  const [ttsCache, editionStoreModule] = await Promise.all([
    getCacheSize().catch(() => ({ entryCount: 0, totalSize: 0, maxSize: 0 })),
    import("../stores/audioEditionGenerationStore"),
  ]);
  const generationStore = editionStoreModule.useAudioEditionGenerationStore.getState();
  const blobCache = editionStoreModule.getSectionAudioBlobCacheStats();
  return {
    takenAt: Date.now(),
    ownedObjectUrls: getOwnedObjectUrlStats(),
    errorAggregates: [...getErrorAggregates()],
    errorRecorderBytes: getErrorRecorderRetainedBytes(),
    sectionAudioBlobCache: blobCache,
    ttsInFlight: getTTSInFlightCount(),
    audioEditionJobs: {
      active: generationStore.activeJobs.length,
      total: Object.keys(generationStore.jobs).length,
    },
    ttsCache: {
      entryCount: ttsCache.entryCount,
      totalSize: ttsCache.totalSize,
      maxSize: ttsCache.maxSize,
    },
    ttsCacheConnections: getTtsCacheConnectionCount(),
  };
}
