#!/usr/bin/env node
/**

 Unit test for min-cursor GC (design.md §4.4, task 3.9). Exercises
 syncLog/gc.js directly against a throwaway SQLite file — no server process
 needed since GC has no HTTP surface.

 Run: node yjs-sync/file-service/test/sync-log-gc.mjs

*/

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { openDb } from "../syncLog/db.js";
import { runGc } from "../syncLog/gc.js";

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

function insertOp(db, room, seq, kind, hlc) {
  db.prepare(
    "INSERT INTO ops (room, seq, key_tag, hlc, kind, blob) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(room, seq, crypto.randomBytes(32), hlc, kind, Buffer.from("x"));
}

function insertUpsert(db, room, seq, hlc) {
  db.prepare(
    "INSERT INTO ops (room, seq, key_tag, hlc, kind, blob) VALUES (?, ?, ?, ?, 0, ?)",
  ).run(room, seq, crypto.randomBytes(32), hlc, Buffer.from("x"));
}

function setCursor(db, room, deviceTag, cursor, seenAt) {
  db.prepare(
    "INSERT INTO device_cursor (room, device_tag, cursor, seen_at) VALUES (?, ?, ?, ?)",
  ).run(room, deviceTag, cursor, seenAt);
}

function countOps(db, room) {
  return db.prepare("SELECT COUNT(*) AS n FROM ops WHERE room = ?").get(room).n;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-log-gc-test-"));
  const db = openDb(path.join(dir, "db.sqlite"));

  try {
    console.log("test: appends read by every device are reclaimed");
    {
      const room = "gc-room-appends";
      const now = Date.now();
      insertOp(db, room, 1, 2, "0000000000001.000001");
      insertOp(db, room, 2, 2, "0000000000002.000001");
      insertOp(db, room, 3, 2, "0000000000003.000001");
      setCursor(db, room, Buffer.from("device-a"), 2, now);
      setCursor(db, room, Buffer.from("device-b"), 3, now);
      // min(cursor) = 2, so seq<=2 is reclaimable, seq=3 survives.
      runGc(db, { now });
      ok(countOps(db, room) === 1, "only the unread append (seq=3) survives");
    }

    console.log("test: a stale device does not block reclamation");
    {
      const room = "gc-room-stale-device";
      const now = Date.now();
      const staleSeenAt = now - 200 * 24 * 60 * 60 * 1000; // 200 days ago
      insertOp(db, room, 1, 2, "0000000000001.000001");
      insertOp(db, room, 2, 2, "0000000000002.000001");
      setCursor(db, room, Buffer.from("device-fresh"), 2, now);
      setCursor(db, room, Buffer.from("device-abandoned"), 0, staleSeenAt);
      // Without staleness exclusion, min(cursor)=0 and nothing would be reclaimed.
      runGc(db, { now });
      ok(countOps(db, room) === 0, "abandoned device excluded from the reclamation threshold");
    }

    console.log("test: upserts are never reclaimed regardless of cursors");
    {
      const room = "gc-room-upserts";
      const now = Date.now();
      insertUpsert(db, room, 1, "0000000000001.000001");
      insertUpsert(db, room, 2, "0000000000002.000001");
      setCursor(db, room, Buffer.from("device-a"), 100, now);
      runGc(db, { now });
      ok(countOps(db, room) === 2, "upsert rows survive GC no matter how far cursors advance");
    }

    console.log("test: recent tombstones are retained past the min-age window");
    {
      const room = "gc-room-tombstone-recent";
      const now = Date.now();
      db.prepare(
        "INSERT INTO ops (room, seq, key_tag, hlc, kind, blob) VALUES (?, 1, ?, ?, 1, ?)",
      ).run(room, crypto.randomBytes(32), `${String(now).padStart(13, "0")}.000001`, Buffer.from("x"));
      setCursor(db, room, Buffer.from("device-a"), 1, now);
      runGc(db, { now });
      ok(countOps(db, room) === 1, "a freshly-aged tombstone is not yet reclaimed");
    }

    console.log("test: aged tombstones ARE reclaimed once every device has read past them");
    {
      const room = "gc-room-tombstone-aged";
      const now = Date.now();
      const oldMs = now - 48 * 60 * 60 * 1000; // 2 days old
      db.prepare(
        "INSERT INTO ops (room, seq, key_tag, hlc, kind, blob) VALUES (?, 1, ?, ?, 1, ?)",
      ).run(room, crypto.randomBytes(32), `${String(oldMs).padStart(13, "0")}.000001`, Buffer.from("x"));
      setCursor(db, room, Buffer.from("device-a"), 1, now);
      runGc(db, { now });
      ok(countOps(db, room) === 0, "an aged, fully-read tombstone is reclaimed");
    }

    console.log(`All GC tests passed (${passed} assertions).`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});
