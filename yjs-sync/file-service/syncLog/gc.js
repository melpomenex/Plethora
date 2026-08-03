/**

 Min-cursor GC (design.md §4.4). Appends (kind=2) and sufficiently aged
 tombstones (kind=1) are deleted once every non-stale device in the room
 has read past them. Upserts (kind=0) are never reclaimed — they are the
 state. Kafka-consumer-group-style retention: a device stale past
 DEVICE_STALE_DAYS stops holding the log back, and reconnects to a
 from-cursor-0 pull instead (spec.md: no device offline duration silently
 desyncs).

*/

const DEVICE_STALE_DAYS = Number(process.env.SYNC_LOG_DEVICE_STALE_DAYS || 90);
const TOMBSTONE_MIN_AGE_MS = Number(process.env.SYNC_LOG_TOMBSTONE_MIN_AGE_MS || 24 * 60 * 60 * 1000);

/**
 * Run one GC pass over every room that has device_cursor rows.
 * @param {import('better-sqlite3').Database} db
 * @param {{now?: number}} [options]
 */
export function runGc(db, options = {}) {
  const now = options.now ?? Date.now();
  const staleCutoff = now - DEVICE_STALE_DAYS * 24 * 60 * 60 * 1000;
  const tombstoneCutoffIso = hlcCutoff(now - TOMBSTONE_MIN_AGE_MS);

  const rooms = db
    .prepare("SELECT DISTINCT room FROM device_cursor")
    .all()
    .map((r) => r.room);

  const minCursorStmt = db.prepare(
    "SELECT MIN(cursor) AS keep FROM device_cursor WHERE room = ? AND seen_at >= ?",
  );
  const deleteAppendsStmt = db.prepare("DELETE FROM ops WHERE room = ? AND kind = 2 AND seq <= ?");
  const deleteTombstonesStmt = db.prepare(
    "DELETE FROM ops WHERE room = ? AND kind = 1 AND seq <= ? AND hlc < ?",
  );

  const results = [];
  for (const room of rooms) {
    const row = minCursorStmt.get(room, staleCutoff);
    const keep = row?.keep;
    // No non-stale device reporting a cursor: nothing is safely reclaimable.
    if (keep === null || keep === undefined) {
      results.push({ room, keep: null, appendsDeleted: 0, tombstonesDeleted: 0 });
      continue;
    }
    const appendsDeleted = deleteAppendsStmt.run(room, keep).changes;
    const tombstonesDeleted = deleteTombstonesStmt.run(room, keep, tombstoneCutoffIso).changes;
    results.push({ room, keep, appendsDeleted, tombstonesDeleted });
  }
  return results;
}

/**
 * The hlc wire format (nowHLC()) is "<13-digit ms>.<6-digit counter>" — a
 * cutoff at millisecond `ms` with counter 0 sorts correctly against it via
 * plain string comparison, since both sides are fixed-width zero-padded.
 */
function hlcCutoff(ms) {
  const clamped = Math.max(0, Math.floor(ms));
  return `${String(clamped).padStart(13, "0")}.000000`;
}

export function startGcLoop(db, intervalMs = 60 * 60 * 1000) {
  const timer = setInterval(() => {
    try {
      runGc(db);
    } catch (err) {
      console.error("[syncLog gc] error during GC pass:", err);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export const __test = { hlcCutoff, DEVICE_STALE_DAYS, TOMBSTONE_MIN_AGE_MS };
