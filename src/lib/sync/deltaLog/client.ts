/**

 Delta-log transport client (design.md §4.2, task 4.1). Talks to the server
 built in yjs-sync/file-service/syncLog/*.js. Purely a transport: it moves
 already-encrypted ops (`{keyTag, hlc, kind, blob}`) back and forth and knows
 nothing about domains, entities, or projection — that split mirrors the
 client/server boundary itself (the server can't see inside an op; there is
 no reason for this module to pretend otherwise). Domain routing happens one
 layer up, in the projector (Phase 5), after an op is decrypted.

 Every request is signed per src/lib/sync/encryption.ts::signRequest, under
 the room's `manifestAuthKey`. See design.md §9 for why pull is a single
 room-wide cursor rather than one per domain.

*/

import { signRequest } from "../encryption";

export type OpKind = 0 | 1 | 2; // 0 = upsert, 1 = delete, 2 = append

export interface DeltaLogOp {
  keyTag: string; // base64
  hlc: string;
  kind: OpKind;
  blob: string; // base64
}

export interface DeltaLogOpRow extends DeltaLogOp {
  seq: number;
}

export interface DeltaLogDeviceEntry {
  deviceTag: string; // base64
  cursor: number;
  seenAt: number;
  /** Opaque, client-encrypted presence payload (task 5.6) — base64, or null if this device hasn't reported one. Server never inspects it. */
  presenceBlob: string | null;
}

export interface DeltaLogClientConfig {
  /** e.g. "https://sync.readsync.org" — derived from the wss:// setting, see urls.ts */
  httpBase: string;
  /** e.g. "wss://sync.readsync.org" */
  wsBase: string;
  room: string;
  manifestAuthKey: CryptoKey;
}

export class DeltaLogHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DeltaLogHttpError";
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function signedFetch(
  config: DeltaLogClientConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const bodyBytes = body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body));
  const signed = await signRequest(method, path, bodyBytes, config.manifestAuthKey);
  const res = await fetch(`${config.httpBase}${path}`, {
    method,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Sync-Timestamp": String(signed.timestamp),
      "X-Sync-Signature": signed.signature,
    },
    body: body === undefined ? undefined : bodyBytes,
  });
  return res;
}

/** Register this device's manifestAuthKey with a brand-new room (trust-on-first-use, see yjs-sync/file-service/syncLog/auth.js). Call once, before any other request for a fresh room. */
export async function registerRoom(config: DeltaLogClientConfig): Promise<void> {
  const path = `/rooms/${config.room}/head`;
  const rawKey = await crypto.subtle.exportKey("raw", config.manifestAuthKey as CryptoKey);
  const signed = await signRequest("GET", path, new Uint8Array(0), config.manifestAuthKey);
  const res = await fetch(`${config.httpBase}${path}`, {
    method: "GET",
    headers: {
      "X-Sync-Timestamp": String(signed.timestamp),
      "X-Sync-Signature": signed.signature,
      "X-Sync-Room-Key": bytesToB64(new Uint8Array(rawKey)),
    },
  });
  if (!res.ok) throw new DeltaLogHttpError(res.status, `registerRoom failed: ${res.status}`);
}

export async function push(config: DeltaLogClientConfig, ops: DeltaLogOp[]): Promise<{ head: number }> {
  if (ops.length === 0) return { head: (await head(config)).head };
  const res = await signedFetch(config, "POST", `/rooms/${config.room}/ops`, { ops });
  if (!res.ok) throw new DeltaLogHttpError(res.status, `push failed: ${res.status}`);
  return res.json();
}

/**
 * Pull one bounded page starting after `since` (design.md §9: a single
 * room-wide cursor, not per-domain). The caller is responsible for
 * decrypting/routing each row and advancing its own checkpoint by
 * `page.ops[page.ops.length - 1].seq` only after every row in the page has
 * been durably projected (spec.md: "persist the cursor only after a page
 * has been fully projected").
 */
export async function pull(
  config: DeltaLogClientConfig,
  since: number,
  limit = 500,
): Promise<{ ops: DeltaLogOpRow[]; head: number }> {
  const path = `/rooms/${config.room}/ops?since=${since}&limit=${limit}`;
  const res = await signedFetch(config, "GET", path);
  if (!res.ok) throw new DeltaLogHttpError(res.status, `pull failed: ${res.status}`);
  return res.json();
}

export async function head(
  config: DeltaLogClientConfig,
): Promise<{ head: number; devices: DeltaLogDeviceEntry[] }> {
  const res = await signedFetch(config, "GET", `/rooms/${config.room}/head`);
  if (!res.ok) throw new DeltaLogHttpError(res.status, `head failed: ${res.status}`);
  return res.json();
}

export async function reportCursor(
  config: DeltaLogClientConfig,
  deviceTag: string,
  cursor: number,
  presenceBlob?: string,
): Promise<void> {
  const body: { deviceTag: string; cursor: number; presenceBlob?: string } = { deviceTag, cursor };
  if (presenceBlob !== undefined) body.presenceBlob = presenceBlob;
  const res = await signedFetch(config, "POST", `/rooms/${config.room}/cursor`, body);
  if (!res.ok) throw new DeltaLogHttpError(res.status, `reportCursor failed: ${res.status}`);
}

export interface DeltaLogSubscription {
  close(): void;
}

/**
 * Open the WS notification channel (design.md §4.2). `onHead` fires with the
 * new head seq whenever the room advances; no op payloads travel over the
 * socket, so the caller is expected to `pull()` on receipt. Reconnects with
 * capped backoff on unexpected close; `close()` stops that permanently.
 *
 * Signing follows the query-param convention documented in
 * yjs-sync/file-service/syncLog/ws.js (browsers can't set WS handshake
 * headers): sign `/rooms/{room}?since=N` as the path, then append
 * `&ts=...&sig=...` only to the URL actually used to connect.
 */
export function subscribe(
  config: DeltaLogClientConfig,
  since: number,
  onHead: (head: number) => void,
): DeltaLogSubscription {
  let closed = false;
  let socket: WebSocket | null = null;
  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 30_000;

  const connect = () => {
    if (closed) return;
    void (async () => {
      const signedPath = `/rooms/${config.room}?since=${since}`;
      const signed = await signRequest("GET", signedPath, "", config.manifestAuthKey);
      if (closed) return;
      const url = `${config.wsBase}/rooms/${config.room}?since=${since}&ts=${signed.timestamp}&sig=${signed.signature}`;
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        backoffMs = 1000;
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (typeof data.head === "number") onHead(data.head);
        } catch {
          // ignore malformed notification
        }
      };
      ws.onclose = () => {
        if (closed) return;
        const delay = backoffMs;
        backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
        setTimeout(connect, delay);
      };
      ws.onerror = () => {
        ws.close();
      };
    })();
  };
  connect();

  return {
    close(): void {
      closed = true;
      socket?.close();
      socket = null;
    },
  };
}
