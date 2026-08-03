/**

 Request authentication for the delta-log sync service (design.md §4.2,
 spec.md "All sync requests shall be authenticated").

 The server never receives a room secret or the state/file decryption keys —
 only `manifestAuthKey`, an auth-only HKDF sub-key (src/lib/sync/encryption.ts),
 which looks like random bytes and cannot decrypt anything. It has to reach
 the server somehow for the server to verify request HMACs against it, and
 design.md does not spell out a provisioning endpoint (the endpoint table in
 §4.2 has exactly five entries, none of them registration). This module
 implements the simplest scheme consistent with that: trust-on-first-use.

   - The FIRST request for a room may carry an `X-Sync-Room-Key` header
     (base64 manifestAuthKey). If the room has no stored key yet AND the
     request's signature verifies under that supplied key, the key is
     persisted and the request proceeds.
   - Every request after that must be signed (HMAC-SHA256 over
     method || path || body || timestamp, matching
     src/lib/sync/encryption.ts::signRequest byte-for-byte) under the
     already-registered key. A room with a registered key ignores
     `X-Sync-Room-Key` — registration is one-shot, not a standing bypass.
   - A request with neither a valid signature nor a first-registration
     header is rejected with a generic 401 that does not distinguish
     "wrong signature" from "room doesn't exist yet" (spec.md: "SHALL NOT
     disclose whether the room exists").

 Known limitation: TOFU means whoever's first request for a fresh room id
 wins registration — there is no separate identity check. Room ids are
 128-bit-plus random tokens (see roomCrypto.ts), so winning a race requires
 guessing one, which is the same assumption the rest of the zero-knowledge
 design already rests on.

*/

import crypto from "crypto";

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000; // matches encryption.ts's default

function buildSignedMessage(method, path, body, timestamp) {
  const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
  return Buffer.concat([
    Buffer.from(method.toUpperCase(), "utf8"),
    Buffer.from([0]),
    Buffer.from(path, "utf8"),
    Buffer.from([0]),
    Buffer.from(String(timestamp), "utf8"),
    Buffer.from([0]),
    bodyBuf,
  ]);
}

function hmac(keyBuf, messageBuf) {
  return crypto.createHmac("sha256", keyBuf).update(messageBuf).digest();
}

function timingSafeEqualHex(aHex, bBuf) {
  let aBuf;
  try {
    aBuf = Buffer.from(aHex, "hex");
  } catch {
    return false;
  }
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Verify (or first-register) a request's signature. Returns the room's
 * auth key (Buffer) on success, or null if the caller should reject with a
 * generic 401. Never throws for malformed input — malformed input is just
 * treated as unauthenticated.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} room
 * @param {{method: string, path: string, body: Buffer|string}} req
 * @param {{timestamp?: string, signature?: string, roomKeyB64?: string}} headers
 * @param {{now?: number, maxSkewMs?: number}} [options]
 */
export function authenticate(db, room, req, headers, options = {}) {
  const now = options.now ?? Date.now();
  const maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;

  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxSkewMs) return null;
  if (typeof headers.signature !== "string" || headers.signature.length === 0) return null;

  const message = buildSignedMessage(req.method, req.path, req.body, timestamp);

  const existing = db.prepare("SELECT auth_key FROM room_auth WHERE room = ?").get(room);
  if (existing) {
    const expected = hmac(existing.auth_key, message);
    return timingSafeEqualHex(headers.signature, expected) ? existing.auth_key : null;
  }

  // No key registered yet: only a first-registration request can succeed.
  if (typeof headers.roomKeyB64 !== "string" || headers.roomKeyB64.length === 0) return null;
  let candidateKey;
  try {
    candidateKey = Buffer.from(headers.roomKeyB64, "base64");
  } catch {
    return null;
  }
  if (candidateKey.length !== 32) return null; // HKDF sub-keys are 32 bytes

  const expected = hmac(candidateKey, message);
  if (!timingSafeEqualHex(headers.signature, expected)) return null;

  db.prepare(
    "INSERT INTO room_auth (room, auth_key, registered_at) VALUES (?, ?, ?)",
  ).run(room, candidateKey, now);
  return candidateKey;
}

export const __test = { buildSignedMessage, hmac };
