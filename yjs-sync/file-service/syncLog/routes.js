/**

 HTTP routes for the delta-log sync service (design.md §4.2).

 All bodies are read as raw bytes (not express.json()) because request
 signatures cover the exact bytes the client signed — re-serializing a
 parsed-then-stringified JSON body would not reliably reproduce them
 (key order, whitespace). Handlers parse JSON themselves after auth passes.

*/

import express from "express";
import crypto from "crypto";
import { authenticate } from "./auth.js";
import { notifyRoom } from "./ws.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // design.md §4.3
const MAX_PAGE_ROWS = 500;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

function isSafeRoom(room) {
  return typeof room === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(room);
}

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

function fromB64(s, label) {
  if (typeof s !== "string") throw new Error(`${label} must be a base64 string`);
  const buf = Buffer.from(s, "base64");
  if (buf.length === 0 && s.length > 0) throw new Error(`${label} is not valid base64`);
  return buf;
}

function nextSeq(db, room) {
  const row = db.prepare("SELECT next_seq FROM room_seq WHERE room = ?").get(room);
  const seq = row ? row.next_seq : 1;
  db.prepare(
    "INSERT INTO room_seq (room, next_seq) VALUES (?, ?) ON CONFLICT(room) DO UPDATE SET next_seq = excluded.next_seq",
  ).run(room, seq + 1);
  return seq;
}

function headSeq(db, room) {
  const row = db.prepare("SELECT next_seq FROM room_seq WHERE room = ?").get(room);
  return row ? row.next_seq - 1 : 0;
}

/**
 * Auth middleware factory: requires a valid signature (or first-registration)
 * for req.params.room. On success sets req.syncAuthKey and req.rawBody.
 */
function requireAuth(db) {
  return (req, res, next) => {
    const room = req.params.room;
    if (!isSafeRoom(room)) {
      // Same generic rejection as an auth failure — do not distinguish
      // "malformed room" from "unauthenticated" (spec.md).
      return res.status(401).json({ error: "unauthorized" });
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const authKey = authenticate(
      db,
      room,
      // originalUrl (path + query string), not req.path, so query
      // parameters like ?since=&limit= are covered by the signature too —
      // otherwise an on-path attacker could tamper with them freely.
      { method: req.method, path: req.originalUrl, body: rawBody },
      {
        timestamp: req.header("X-Sync-Timestamp"),
        signature: req.header("X-Sync-Signature"),
        roomKeyB64: req.header("X-Sync-Room-Key"),
      },
    );
    if (!authKey) return res.status(401).json({ error: "unauthorized" });
    req.syncAuthKey = authKey;
    req.rawBody = rawBody;
    next();
  };
}

export function createSyncLogRouter(db) {
  const router = express.Router();

  // Raw-body capture, scoped to this router, bounded per design.md §4.3.
  router.use(
    express.raw({ type: () => true, limit: MAX_BODY_BYTES }),
  );

  const auth = requireAuth(db);

  router.post("/rooms/:room/ops", auth, (req, res) => {
    const room = req.params.room;
    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString("utf8") || "{}");
    } catch {
      return res.status(400).json({ error: "invalid JSON body" });
    }
    if (!Array.isArray(payload.ops)) {
      return res.status(400).json({ error: "ops must be an array" });
    }

    const upsertStmt = db.prepare(`
      INSERT INTO ops (room, seq, key_tag, hlc, kind, blob)
      VALUES (@room, @seq, @keyTag, @hlc, @kind, @blob)
      ON CONFLICT (room, key_tag) WHERE kind IN (0, 1) DO UPDATE SET
        seq  = @seq,
        hlc  = excluded.hlc,
        kind = excluded.kind,
        blob = excluded.blob
      WHERE excluded.hlc > ops.hlc
    `);
    const appendStmt = db.prepare(`
      INSERT INTO ops (room, seq, key_tag, hlc, kind, blob)
      VALUES (@room, @seq, @keyTag, @hlc, @kind, @blob)
    `);

    const applyAll = db.transaction((ops) => {
      for (const op of ops) {
        if (
          typeof op.hlc !== "string" ||
          !Number.isInteger(op.kind) ||
          op.kind < 0 ||
          op.kind > 2
        ) {
          throw new Error("malformed op");
        }
        const keyTag = fromB64(op.keyTag, "keyTag");
        const blob = fromB64(op.blob, "blob");
        const seq = nextSeq(db, room);
        const row = { room, seq, keyTag, hlc: op.hlc, kind: op.kind, blob };
        if (op.kind === 2) appendStmt.run(row);
        else upsertStmt.run(row);
      }
    });

    try {
      applyAll(payload.ops);
    } catch (err) {
      return res.status(400).json({ error: `apply failed: ${err.message}` });
    }

    const head = headSeq(db, room);
    notifyRoom(room, head);
    res.status(200).json({ head });
  });

  router.get("/rooms/:room/ops", auth, (req, res) => {
    const room = req.params.room;
    const since = Math.max(0, Number(req.query.since) || 0);
    const limit = Math.min(MAX_PAGE_ROWS, Math.max(1, Number(req.query.limit) || MAX_PAGE_ROWS));

    // Each entity appears at most once per page set because ops_live keeps
    // only one live row per (room, key_tag) and re-issues seq on update —
    // a page is simply "the next N rows by seq", no de-dup needed here.
    const rows = db
      .prepare("SELECT seq, key_tag, hlc, kind, blob FROM ops WHERE room = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(room, since, limit);

    const out = [];
    let bytes = 0;
    for (const row of rows) {
      const entry = {
        seq: row.seq,
        keyTag: b64(row.key_tag),
        hlc: row.hlc,
        kind: row.kind,
        blob: b64(row.blob),
      };
      const entrySize = row.key_tag.length + row.blob.length + row.hlc.length + 16;
      // Always return at least one row even if it alone exceeds the cap —
      // rejecting it outright would wedge the client's cold start forever.
      if (out.length > 0 && bytes + entrySize > MAX_PAGE_BYTES) break;
      out.push(entry);
      bytes += entrySize;
    }

    res.status(200).json({ ops: out, head: headSeq(db, room) });
  });

  router.get("/rooms/:room/head", auth, (req, res) => {
    const room = req.params.room;
    const devices = db
      .prepare("SELECT device_tag, cursor, seen_at, presence_blob FROM device_cursor WHERE room = ?")
      .all(room)
      .map((d) => ({
        deviceTag: b64(d.device_tag),
        cursor: d.cursor,
        seenAt: d.seen_at,
        presenceBlob: d.presence_blob ? b64(d.presence_blob) : null,
      }));
    res.status(200).json({ head: headSeq(db, room), devices });
  });

  router.post("/rooms/:room/cursor", auth, (req, res) => {
    const room = req.params.room;
    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString("utf8") || "{}");
    } catch {
      return res.status(400).json({ error: "invalid JSON body" });
    }
    let deviceTag;
    try {
      deviceTag = fromB64(payload.deviceTag, "deviceTag");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const cursor = Number(payload.cursor);
    if (!Number.isInteger(cursor) || cursor < 0) {
      return res.status(400).json({ error: "cursor must be a non-negative integer" });
    }
    // Optional opaque presence blob (task 5.6): client-encrypted, server
    // never inspects it. Omitting it leaves any previously-stored blob in
    // place (a plain sync-only cursor report shouldn't erase file presence
    // reported moments earlier by a different code path on the same device).
    let presenceBlob;
    if (payload.presenceBlob !== undefined && payload.presenceBlob !== null) {
      try {
        presenceBlob = fromB64(payload.presenceBlob, "presenceBlob");
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }
    const now = Date.now();
    if (presenceBlob !== undefined) {
      db.prepare(`
        INSERT INTO device_cursor (room, device_tag, cursor, seen_at, presence_blob)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (room, device_tag) DO UPDATE SET cursor = excluded.cursor, seen_at = excluded.seen_at, presence_blob = excluded.presence_blob
      `).run(room, deviceTag, cursor, now, presenceBlob);
    } else {
      db.prepare(`
        INSERT INTO device_cursor (room, device_tag, cursor, seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (room, device_tag) DO UPDATE SET cursor = excluded.cursor, seen_at = excluded.seen_at
      `).run(room, deviceTag, cursor, now);
    }
    res.status(200).json({ ok: true });
  });

  return router;
}

export const __test = { isSafeRoom, MAX_PAGE_ROWS, MAX_PAGE_BYTES };
