/**
 * Collection-keyed "recently opened" tracking.
 *
 * The palette's Open recent document action prefers the most recently *opened*
 * document rather than the most recently *modified* one (`date_modified` is
 * bumped by any metadata edit). Records are written at the document-open /
 * active-reader boundary — never when a palette preview merely renders — and
 * keyed by collection so a scope change cannot reuse another collection's
 * target.
 *
 * Persistence is a small localStorage map; corrupt data is ignored rather
 * than repaired. This is an optional accelerator: when no record exists the
 * home model falls back to modification time with honest wording.
 */

import { useCollectionStore } from "../stores/collectionStore";
import type { Document } from "../types/document";

export interface RecentOpenEntry {
  documentId: string;
  /** Epoch ms when the open was recorded. */
  openedAt: number;
  /** Title snapshot so capped document caches can still show the target. */
  title?: string;
  fileType?: Document["fileType"];
}

export const RECENT_OPENS_STORAGE_KEY = "plethora-recent-opens";

const MAX_PER_COLLECTION = 20;
const MAX_COLLECTIONS = 50;
const DEFAULT_COLLECTION_KEY = "default";

type RecentOpenMap = Record<string, RecentOpenEntry[]>;

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readMap(): RecentOpenMap {
  if (!storageAvailable()) return {};
  try {
    const raw = localStorage.getItem(RECENT_OPENS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const map: RecentOpenMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const entries = value.filter(
        (entry): entry is RecentOpenEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as RecentOpenEntry).documentId === "string" &&
          typeof (entry as RecentOpenEntry).openedAt === "number" &&
          Number.isFinite((entry as RecentOpenEntry).openedAt)
      );
      map[key] = entries.slice(0, MAX_PER_COLLECTION);
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: RecentOpenMap): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(RECENT_OPENS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full / unavailable — the feature degrades to the fallback.
  }
}

function collectionKey(collectionId: string | null | undefined): string {
  return collectionId && collectionId.length > 0 ? collectionId : DEFAULT_COLLECTION_KEY;
}

/**
 * Record a document open for the given (or active) collection. Deduplicates
 * the document within its collection and keeps the newest entry first.
 */
export function recordRecentOpen(
  documentId: string,
  options: {
    collectionId?: string | null;
    title?: string;
    fileType?: Document["fileType"];
    now?: number;
  } = {}
): void {
  if (!documentId) return;
  const collectionId =
    options.collectionId ?? useCollectionStore.getState().activeCollectionId;
  const key = collectionKey(collectionId);
  const now = options.now ?? Date.now();

  const map = readMap();
  const existing = map[key] ?? [];
  const withoutDuplicate = existing.filter((entry) => entry.documentId !== documentId);
  map[key] = [
    {
      documentId,
      openedAt: now,
      ...(options.title ? { title: options.title } : {}),
      ...(options.fileType ? { fileType: options.fileType } : {}),
    },
    ...withoutDuplicate,
  ].slice(0, MAX_PER_COLLECTION);

  // Bound the number of tracked collections; keep the most recently touched.
  const keys = Object.keys(map);
  if (keys.length > MAX_COLLECTIONS) {
    const ranked = keys.sort((a, b) => {
      const aLatest = map[a]?.[0]?.openedAt ?? 0;
      const bLatest = map[b]?.[0]?.openedAt ?? 0;
      return bLatest - aLatest;
    });
    for (const stale of ranked.slice(MAX_COLLECTIONS)) {
      delete map[stale];
    }
  }

  writeMap(map);
}

/** Recent openings for one collection, newest first. */
export function getRecentOpens(collectionId: string | null | undefined): RecentOpenEntry[] {
  const map = readMap();
  const entries = map[collectionKey(collectionId)] ?? [];
  return [...entries].sort((a, b) => b.openedAt - a.openedAt);
}

/** The most recent opening for one collection, if any. */
export function getMostRecentOpen(
  collectionId: string | null | undefined
): RecentOpenEntry | null {
  return getRecentOpens(collectionId)[0] ?? null;
}

/** Test helper: drop all recorded openings. */
export function clearRecentOpens(): void {
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(RECENT_OPENS_STORAGE_KEY);
  } catch {
    // ignore
  }
}
