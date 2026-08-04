/**

 Cursor persistence for the delta-log transport (task 4.2), built on the
 existing `sync_checkpoints` table (migration 056) rather than a new one.

 Per design.md §9's resolved open question, there is exactly ONE resumable
 pull cursor per room (the server has one seq stream, not one per domain) —
 stored under the synthetic domain key below. Per-entity-domain rows in the
 same table are still written (see recordDomainProgress), but only as a
 diagnostics/UI record of how far each domain's projection has gotten
 *within* the pages already pulled; they never drive a fetch.

*/

import { getSyncCheckpoint, setSyncCheckpoint } from "../syncJournal";

/** Synthetic domain key for the single room-wide pull cursor. Not a real sync domain. */
export const ROOM_CURSOR_DOMAIN = "deltaLog:room";

/**
 * Read the pull cursor, scoped to `room`.
 *
 * Seq numbers are per-room: seq 8270 in the old room means nothing in a new
 * one. Carrying a stale cursor across a room switch (rotate secret / join a
 * different room) makes every `pull(since = staleSeq)` return an empty page,
 * so the device silently never receives anything from the new room. The
 * owning room is recorded in the checkpoint's `shard` column; a mismatch
 * restarts the cold pull from 0.
 *
 * `room` is optional for backward compatibility, and a checkpoint written by
 * an older build (shard = null) is treated as belonging to the current room —
 * so upgrading does not force a full re-pull.
 */
export async function getRoomCursor(room?: string): Promise<number> {
  const checkpoint = (await getSyncCheckpoint(ROOM_CURSOR_DOMAIN)) as
    | { cursor?: string | null; shard?: string | null }
    | null;
  if (room && checkpoint?.shard && checkpoint.shard !== room) return 0;
  const parsed = checkpoint?.cursor ? Number(checkpoint.cursor) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function setRoomCursor(seq: number, room?: string): Promise<void> {
  await setSyncCheckpoint({ domain: ROOM_CURSOR_DOMAIN, cursor: String(seq), shard: room ?? null });
}

/** Diagnostics-only: last seq this domain has been projected through. */
export async function recordDomainProgress(domain: string, seq: number): Promise<void> {
  await setSyncCheckpoint({ domain: `deltaLog:domain:${domain}`, cursor: String(seq) });
}

export async function getDomainProgress(domain: string): Promise<number> {
  const checkpoint = (await getSyncCheckpoint(`deltaLog:domain:${domain}`)) as
    | { cursor?: string | null }
    | null;
  const parsed = checkpoint?.cursor ? Number(checkpoint.cursor) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Reset every delta-log cursor to 0 (task 4.2). Call on room switch (join a
 * different room, or rotate the room secret) so the next boot does a clean
 * paged cold start against the new room rather than resuming a stale seq
 * that means something different there.
 */
export async function resetDeltaLogCursors(domains: string[]): Promise<void> {
  await setRoomCursor(0);
  await Promise.all(domains.map((domain) => recordDomainProgress(domain, 0)));
}
