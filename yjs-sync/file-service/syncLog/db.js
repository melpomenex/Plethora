/**

 SQLite storage for the delta-log sync service (design.md §4.1).

 One process-wide connection in WAL mode with a fixed page cache, opened
 once at startup. No per-room state is held here beyond what SQLite itself
 caches — the resource-bound requirement (design.md §4.3, spec "fixed small
 resource budget") is met by NOT keeping any in-memory room/document object,
 unlike the Yjs relay's per-room WSSharedDoc.

*/

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.SYNC_LOG_DB_PATH || "/data/sync-log/sync-log.sqlite";
// ~48 MiB fixed page cache (design.md §4.3), independent of room count.
const PAGE_CACHE_KIB = Number(process.env.SYNC_LOG_PAGE_CACHE_KIB || 48 * 1024);

export function openDb(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma(`cache_size = -${PAGE_CACHE_KIB}`); // negative = KiB, not pages
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ops (
      room     TEXT    NOT NULL,
      seq      INTEGER NOT NULL,
      key_tag  BLOB    NOT NULL,
      hlc      TEXT    NOT NULL,
      kind     INTEGER NOT NULL,
      blob     BLOB    NOT NULL,
      PRIMARY KEY (room, seq)
    );

    -- The compaction invariant: at most one live row per (room, key_tag)
    -- for upserts (kind=0) and tombstones (kind=1). Appends (kind=2) are
    -- exempt and accumulate until GC'd by min-cursor (gc.js).
    CREATE UNIQUE INDEX IF NOT EXISTS ops_live ON ops(room, key_tag) WHERE kind IN (0, 1);

    CREATE TABLE IF NOT EXISTS room_seq (
      room     TEXT    PRIMARY KEY,
      next_seq INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS device_cursor (
      room       TEXT    NOT NULL,
      device_tag BLOB    NOT NULL,
      cursor     INTEGER NOT NULL,
      seen_at    INTEGER NOT NULL,
      -- Opaque, client-encrypted presence payload (migrate-sync-to-delta-log
      -- task 5.6): today this carries the device's file-availability list
      -- (FileManifest's devicePresence.hasFiles), sealed under the room's
      -- fileKey before it ever reaches this table. The server stores and
      -- forwards bytes only — same zero-knowledge posture as an op blob.
      -- NULL means the device hasn't reported presence (older client, or a
      -- pure sync-only cursor report with nothing to say about files).
      presence_blob BLOB,
      PRIMARY KEY (room, device_tag)
    );

    -- Not in design.md's schema directly, but required to make "every
    -- request is authenticated with a key derived from the room secret"
    -- (spec.md) actually checkable server-side: the server must hold
    -- *something* to verify an HMAC against. It never receives the room
    -- secret or the decryption keys (stateKey/fileKey) — only
    -- manifestAuthKey, an auth-only sub-key, registered once per room on
    -- trust-on-first-use (see syncLog/auth.js for the registration rule).
    CREATE TABLE IF NOT EXISTS room_auth (
      room          TEXT    PRIMARY KEY,
      auth_key      BLOB    NOT NULL,
      registered_at INTEGER NOT NULL
    );
  `);
}
