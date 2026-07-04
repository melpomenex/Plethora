/**
 * First-join migration / backfill runner.
 *
 * On the first time a device joins a sync room (or sync is first enabled), this
 * publishes the device's local library into the shared Yjs doc so other devices
 * receive it, and conversely receives whatever the room already holds (the
 * replication layer's observe+replay handles that part automatically once the
 * maps are ready). This is the "no inconvenience" piece: the user enables sync
 * and their existing cards/feeds/podcasts just appear on the other device,
 * without any manual export/import.
 *
 * Idempotent — gated by `incrementum_yjs_migration_v1_done` (cleared on room
 * change so joining a NEW room re-seeds). Runs entirely in the background; the
 * app is fully usable during it. Non-fatal: a transient failure just leaves the
 * flag unset so it retries next launch.
 *
 * Provenance ordering matters: cards reference extracts/documents, episodes
 * reference feeds. We publish parents before children so receivers don't see
 * dangling foreign keys (though the FK is soft — receivers tolerate a missing
 * parent briefly).
 */

import { invokeCommand, isTauri } from "../tauri";
import { getSyncRoomId } from "../yjsSync";
import { nowHLC } from "./syncClock";
import {
  publishCard,
  toSyncedLearningItem,
  type SyncedLearningItem,
} from "./entities/flashcards";
import {
  publishCollection,
  toSyncedCollection,
} from "./entities/collections";
import {
  publishExtract,
  toSyncedExtract,
} from "./entities/extracts";
import {
  publishConversation,
  ASSISTANT_CONVERSATIONS_KEY,
} from "./entities/conversations";
import type { Collection } from "../../types/collection";

// Bumped to v3 when assistant-conversation seeding was added. Existing devices
// that already seeded under v2 will re-seed (cheap: conversations are small)
// so their chats propagate to the room.
const MIGRATION_FLAG = "incrementum_yjs_migration_v3_done";

interface MigrationProgress {
  total: number;
  done: number;
  entity: string;
}

export type ProgressListener = (p: MigrationProgress) => void;

/**
 * Run the first-join backfill if it hasn't been done for the current room.
 * Resolves once complete (or no-op). Safe to call on every boot.
 */
export async function runSyncMigrationIfNeeded(
  onProgress?: ProgressListener,
): Promise<void> {
  if (!isTauri()) return;
  const room = getSyncRoomId();
  const flag = `${MIGRATION_FLAG}:${room}`;
  if (typeof window !== "undefined" && window.localStorage.getItem(flag)) {
    return; // already seeded this room
  }

  try {
    await seedCollections(onProgress);
    await seedExtracts(onProgress);
    await seedConversations(onProgress);
    await seedCards(onProgress);
    // RSS feeds + podcast feeds seeding is left to Phase 4/5 follow-up wiring
    // (the publish entry points exist; this runner is intentionally focused on
    // the paramount case — cards — for v1). Each entity module's observe path
    // already receives remote data on join, so this device picks up the room's
    // existing state regardless.

    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(flag, "1");
    }
  } catch (err) {
    // Leave the flag unset so we retry next launch. Don't throw — migration is
    // best-effort and must never block app use.
    console.warn("[sync-migration] backfill failed (will retry next launch)", err);
  }
}

/**
 * Publish all local learning items (cards) into the shared `learningItems` map.
 * Each row gets a fresh `updated_at` so the receiver's row-LWW merge takes it;
 * if the room already has a newer copy of a card (two devices both had it), the
 * merge correctly keeps the newer one.
 */
async function seedCards(onProgress?: ProgressListener): Promise<void> {
  // Read every card (not just due). get_all_learning_items exists on the Rust
  // side; the TS wrapper returns the camelCase-or-snake row we normalize.
  const raw = await invokeCommand<unknown[]>("get_all_learning_items").catch(() => []);
  if (!Array.isArray(raw) || raw.length === 0) {
    onProgress?.({ total: 0, done: 0, entity: "cards" });
    return;
  }

  const total = raw.length;
  onProgress?.({ total, done: 0, entity: "cards" });

  let done = 0;
  // Publish in modest batches to avoid saturating the Yjs doc with a single
  // huge transaction (which can stall the sync handshake). Each publish is
  // independent and idempotent.
  const BATCH = 50;
  for (let i = 0; i < raw.length; i += BATCH) {
    const slice = raw.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (row) => {
        const synced = toSyncedLearningItem(row as Record<string, unknown>);
        // Only stamp a fresh clock if the row lacks one; otherwise keep the
        // existing updated_at so we don't spuriously win a merge against a
        // genuinely newer remote copy.
        if (!synced.updated_at) synced.updated_at = nowHLC();
        synced.updatedAt = synced.updated_at;
        await publishCard(synced as SyncedLearningItem);
      }),
    );
    done += slice.length;
    onProgress?.({ total, done, entity: "cards" });
    // Yield to the event loop between batches so the UI stays responsive.
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * Publish all local collections into Yjs.
 */
async function seedCollections(onProgress?: ProgressListener): Promise<void> {
  const raw = await invokeCommand<Collection[]>("get_collections").catch(() => []);
  if (!Array.isArray(raw) || raw.length === 0) {
    onProgress?.({ total: 0, done: 0, entity: "collections" });
    return;
  }

  const total = raw.length;
  onProgress?.({ total, done: 0, entity: "collections" });

  let done = 0;
  for (const col of raw) {
    await publishCollection(col);
    done += 1;
    onProgress?.({ total, done, entity: "collections" });
  }
}

/**
 * Publish all local extracts into Yjs.
 */
async function seedExtracts(onProgress?: ProgressListener): Promise<void> {
  const raw = await invokeCommand<unknown[]>("get_extracts").catch(() => []);
  if (!Array.isArray(raw) || raw.length === 0) {
    onProgress?.({ total: 0, done: 0, entity: "extracts" });
    return;
  }

  const total = raw.length;
  onProgress?.({ total, done: 0, entity: "extracts" });

  let done = 0;
  const BATCH = 50;
  for (let i = 0; i < raw.length; i += BATCH) {
    const slice = raw.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (row) => {
        const synced = toSyncedExtract(row);
        if (!synced.date_modified) {
          synced.date_modified = new Date().toISOString();
          synced.updatedAt = synced.date_modified;
        }
        await publishExtract(synced);
      }),
    );
    done += slice.length;
    onProgress?.({ total, done, entity: "extracts" });
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * Publish all local assistant conversations into Yjs. Conversations live in
 * localStorage (not SQLite) under one blob keyed by conversation context. We
 * publish each conversation entry individually so the receiver applies them
 * one-key-at-a-time (row-LWW per conversation, not whole-blob).
 */
async function seedConversations(onProgress?: ProgressListener): Promise<void> {
  if (typeof window === "undefined" || !window.localStorage) {
    onProgress?.({ total: 0, done: 0, entity: "conversations" });
    return;
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY);
  } catch {
    onProgress?.({ total: 0, done: 0, entity: "conversations" });
    return;
  }
  if (!raw) {
    onProgress?.({ total: 0, done: 0, entity: "conversations" });
    return;
  }
  let parsed: Record<string, { messages: unknown[]; input?: string }>;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      onProgress?.({ total: 0, done: 0, entity: "conversations" });
      return;
    }
    parsed = obj as Record<string, { messages: unknown[]; input?: string }>;
  } catch {
    onProgress?.({ total: 0, done: 0, entity: "conversations" });
    return;
  }

  const keys = Object.keys(parsed);
  if (keys.length === 0) {
    onProgress?.({ total: 0, done: 0, entity: "conversations" });
    return;
  }

  const total = keys.length;
  onProgress?.({ total, done: 0, entity: "conversations" });
  let done = 0;
  for (const key of keys) {
    const conv = parsed[key];
    if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) {
      done += 1;
      onProgress?.({ total, done, entity: "conversations" });
      continue;
    }
    try {
      await publishConversation(key, { messages: conv.messages, input: conv.input });
    } catch (err) {
      // Best-effort: a single failed conversation must not abort the rest.
      console.warn("[sync-migration] failed to seed conversation", key, err);
    }
    done += 1;
    onProgress?.({ total, done, entity: "conversations" });
  }
}

/** Reset the migration flag (e.g. after a room change so the new room re-seeds). */
export function resetSyncMigrationFlag(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const keys = Object.keys(window.localStorage).filter((k) =>
    k.startsWith(`${MIGRATION_FLAG}:`),
  );
  for (const k of keys) window.localStorage.removeItem(k);
}

export const __migrateTest = { MIGRATION_FLAG, resetSyncMigrationFlag };
