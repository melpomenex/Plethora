/**

 Per-domain seed readers (migrate-sync-to-delta-log Phase 6 P2 wiring).

 Each `readAllSyncedRows(domain)` reads the domain's durable SQLite rows and
 returns them as `SeedRow[]` = `{ entityKey, hlc, operation, payload }`,
 carrying each row's EXISTING clock verbatim. This is the contract
 `runSeedPhase` (../cutover.ts) requires: never re-stamp, never read from the
 Yjs document. The server's `WHERE excluded.hlc > ops.hlc` LWW guard then
 makes a re-seed with an unchanged clock a no-op (design.md §6).

 Reuses the `toSynced*` mappers each entity module already exports, so the
 wire shape produced here is byte-identical to what the publish path emits —
 a seeded row and a freshly-published row are interchangeable on the server.

 Every reader is best-effort: a missing Rust command or a transient SQLite
 error returns `[]` rather than throwing. The seed phase records per-domain
 counts, and a partial seed is a correct prefix (no row can move backwards
 under LWW), so one unreadable domain must not abort the others.
*/

import { invokeCommand, isTauri } from "../../tauri";
import type { SeedRow } from "../cutover";
import { isPortableFilePath } from "../filePathPortability";
import { toSyncedLearningItem } from "../entities/flashcards";
import { toSyncedCollection } from "../entities/collections";
import { toSyncedExtract } from "../entities/extracts";
import { toSyncedConversation, ASSISTANT_CONVERSATIONS_KEY } from "../entities/conversations";
import { toSyncedRssFeed } from "../entities/rss";
import { toSyncedPodcastFeed } from "../entities/podcasts";

async function readRows<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  toSeedRow: (raw: T) => SeedRow | null,
): Promise<SeedRow[]> {
  if (!isTauri()) return [];
  let raw: T[];
  try {
    raw = (await invokeCommand<T[]>(command, args)) ?? [];
  } catch (err) {
    console.warn(`[seed-reader] ${command} failed, seeding 0 rows for this domain`, err);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const rows: SeedRow[] = [];
  for (const item of raw) {
    const seedRow = toSeedRow(item);
    if (seedRow) rows.push(seedRow);
  }
  return rows;
}

/**
 * documents — clock is `dateModified` (or `dateAdded`).
 *
 * Strips the same fields `publishDocument` (documentReplication.ts) strips
 * from its live-write payload: `content` (regenerable extracted text) and
 * `coverImageUrl` (often a 100KB+ base64 data-URL) blow past the outbox's
 * 256KB payload cap (syncPrivacy.ts), and `currentViewState` is device-local.
 * Without this, every seeded document silently failed `isSyncPayloadSafe`
 * and never reached the outbox at all.
 */
export function readDocumentSeedRows(): Promise<SeedRow[]> {
  return readRows<Record<string, unknown>>("get_documents", undefined, (raw) => {
    const id = String(raw.id ?? "");
    if (!id) return null;
    const clock = String(raw.dateModified ?? raw.date_modified ?? raw.dateAdded ?? raw.date_added ?? "");
    const { content: _content, coverImageUrl: _coverImageUrl, currentViewState: _currentViewState, ...lightweight } = raw;
    // A device-local filePath (the common case: an imported PDF/EPUB) must
    // not go out on the wire — the outbox's privacy filter (syncPrivacy.ts)
    // rejects the WHOLE payload if it does, silently dropping the entire
    // document. Mirrors the same omission in publishDocument.
    if (!isPortableFilePath(lightweight.filePath as string | undefined, lightweight.fileType as string | undefined)) {
      delete lightweight.filePath;
    }
    // Mirrors publishDocument: an explicit `metadata: null` reads as "blank
    // your metadata" on the receiver and unlinks its fileId.
    if (lightweight.metadata == null) delete lightweight.metadata;
    return {
      entityKey: id,
      hlc: clock || new Date().toISOString(),
      operation: "upsert",
      payload: lightweight,
    };
  });
}

/** collections — clock is `updatedAt`. */
export function readCollectionSeedRows(): Promise<SeedRow[]> {
  return readRows<Record<string, unknown>>("get_collections", undefined, (raw) => {
    const id = String(raw.id ?? "");
    if (!id) return null;
    const synced = toSyncedCollection(raw as never);
    return { entityKey: id, hlc: synced.updatedAt, operation: "upsert", payload: synced };
  });
}

/** extracts — clock is `date_modified`. */
export function readExtractSeedRows(): Promise<SeedRow[]> {
  return readRows<Record<string, unknown>>("get_extracts", undefined, (raw) => {
    const id = String(raw.id ?? raw.extract_id ?? "");
    if (!id) return null;
    const synced = toSyncedExtract(raw);
    return { entityKey: id, hlc: String(synced.date_modified ?? synced.updatedAt), operation: "upsert", payload: synced };
  });
}

/** learningItems (flashcards) — clock is `updated_at`, preserved by the mapper. */
export function readLearningItemSeedRows(): Promise<SeedRow[]> {
  return readRows<Record<string, unknown>>("get_all_learning_items", undefined, (raw) => {
    const id = String(raw.id ?? "");
    if (!id) return null;
    const synced = toSyncedLearningItem(raw);
    return { entityKey: id, hlc: String(synced.updated_at ?? synced.updatedAt), operation: "upsert", payload: synced };
  });
}

/**
 * assistantConversations — stored in localStorage (not SQLite) under one blob.
 * Clocks here are epoch-ms stored on each conversation; we emit one row per
 * conversation keyed by its stable storage key.
 */
export function readConversationSeedRows(): Promise<SeedRow[]> {
  void ASSISTANT_CONVERSATIONS_KEY; // referenced for the import side-effect / readability
  if (typeof window === "undefined" || !window.localStorage) return Promise.resolve([]);
  let parsed: Record<string, { messages: unknown[]; input?: string; updatedAt?: number }> | null = null;
  try {
    const raw = window.localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY);
    if (!raw) return Promise.resolve([]);
    parsed = JSON.parse(raw);
  } catch {
    return Promise.resolve([]);
  }
  if (!parsed || typeof parsed !== "object") return Promise.resolve([]);
  const rows: SeedRow[] = [];
  for (const [key, conv] of Object.entries(parsed)) {
    if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;
    try {
      const synced = toSyncedConversation(key, { messages: conv.messages, input: conv.input, updatedAt: conv.updatedAt });
      rows.push({ entityKey: key, hlc: synced.updatedAt, operation: "upsert", payload: synced });
    } catch {
      // A single malformed conversation must not abort the rest.
    }
  }
  return Promise.resolve(rows);
}

/** rssFeeds — clock is `updatedAt`. */
export function readRssFeedSeedRows(): Promise<SeedRow[]> {
  return readRows<Record<string, unknown>>("get_rss_feeds", undefined, (raw) => {
    const id = String(raw.id ?? raw.feed_id ?? "");
    if (!id) return null;
    const synced = toSyncedRssFeed(raw);
    return { entityKey: id, hlc: String(synced.updatedAt ?? ""), operation: "upsert", payload: synced };
  });
}

/** podcastFeeds — clock is `updatedAt`. */
export function readPodcastFeedSeedRows(): Promise<SeedRow[]> {
  return readRows<Record<string, unknown>>("get_podcast_feeds", undefined, (raw) => {
    const id = String(raw.id ?? raw.feed_id ?? "");
    if (!id) return null;
    const synced = toSyncedPodcastFeed(raw);
    return { entityKey: id, hlc: String(synced.updatedAt ?? ""), operation: "upsert", payload: synced };
  });
}

/**
 * The full set of durable row-domains this build seeds. Each entry pairs the
 * domain name (the Yjs map name / delta-log `key_tag` domain) with the reader
 * that enumerates its rows. The orchestrator passes this to `runSeedPhase`.
 *
 * Domains deliberately omitted:
 *  - `reviews`, `rssArticlesState`, `podcastEpisodes` — append-only /
 *    field-lww state derived from events rather than a single authoritative
 *    row; their existing publish paths carry them forward on first edit, and
 *    re-seeding stale field clocks would lose to any newer remote clock
 *    anyway. Seeding the parent feeds (rssFeeds, podcastFeeds) is what
 *    recreates the subscription; article/episode state catches up on use.
 *  - `fileManifest`, `fileAvailabilityIntent` — intent, not authoritative
 *    library state; recomputed locally. The design doc (§6) scopes seeding
 *    to "every SQLite row in every synced domain"; these are not rows that
 *    recreate a library on another device.
 *  - `localStorage` — re-seeded from this device's prefs lazily; a separate
 *    concern from the cutover-completeness gate.
 */
export const SEED_DOMAIN_READERS: ReadonlyArray<{ domain: string; readAllRows: () => Promise<SeedRow[]> }> = [
  { domain: "documents", readAllRows: readDocumentSeedRows },
  { domain: "collections", readAllRows: readCollectionSeedRows },
  { domain: "extracts", readAllRows: readExtractSeedRows },
  { domain: "learningItems", readAllRows: readLearningItemSeedRows },
  { domain: "assistantConversations", readAllRows: readConversationSeedRows },
  { domain: "rssFeeds", readAllRows: readRssFeedSeedRows },
  { domain: "podcastFeeds", readAllRows: readPodcastFeedSeedRows },
];
