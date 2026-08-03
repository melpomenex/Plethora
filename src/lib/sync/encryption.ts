// hash-wasm is intentionally never imported here. Argon2id key derivation
// runs exclusively in a Web Worker (see argon2id.worker.ts) to keep the
// main thread responsive. There is no main-thread fallback — a frozen UI
// is worse than failing sync startup.

// ---- constants ----

const ROOM_KEY_BYTES = 32;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const SUB_KEY_BYTES = 32;
const NONCE_DEVICE_PREFIX_BYTES = 4;
const NONCE_COUNTER_BYTES = AES_GCM_NONCE_BYTES - NONCE_DEVICE_PREFIX_BYTES;

const HKDF_INFO_STATE = new TextEncoder().encode('incrementum-sync/state-v1');
const HKDF_INFO_FILES = new TextEncoder().encode('incrementum-sync/files-v1');
const HKDF_INFO_AUTH = new TextEncoder().encode('incrementum-sync/auth-v1');
const HKDF_INFO_INDEX = new TextEncoder().encode('incrementum-sync/index-v1');

export interface SubKeys {
  stateKey: CryptoKey;
  fileKey: CryptoKey;
  manifestAuthKey: CryptoKey;
  /**
   * Delta-log key-tag key (design.md §3). Used only to compute
   * `keyTag(domain, entityKey)` — a keyed hash the server can use to order
   * and compact operations without ever seeing the entity id or domain.
   * Never leaves the device.
   */
  roomIndexKey: CryptoKey;
}

export interface EncryptedChunk {
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptError';
  }
}

// ---- Argon2id key derivation (offloaded to Web Worker) ----

/**
 * A weak map keyed by secret+roomId, used to deduplicate in-flight derivations.
 * Two concurrent calls with the same inputs share one worker invocation rather
 * than spawning two workers and thrashing WASM memory with redundant work.
 */
const inflightDerive = new Map<string, Promise<Uint8Array>>();

function deriveCacheKey(roomSecret: string, roomId: string): string {
  return `${roomId}\x00${roomSecret}`;
}

/**
 * Derive the 32-byte room key from a room secret and room ID using Argon2id.
 *
 * Runs in a Web Worker exclusively to keep the main thread responsive.
 * There is no main-thread fallback — if the Worker API is unavailable
 * or the worker fails, the error propagates to the caller which handles
 * it gracefully (sync won't start, but the app stays responsive).
 *
 * Concurrent calls with the same (secret, roomId) share one derivation;
 * the duplicate callers await the same promise returned by the first.
 */
export async function deriveRoomKey(
  roomSecret: string,
  roomId: string,
): Promise<Uint8Array> {
  if (!roomSecret) throw new Error('deriveRoomKey: roomSecret is required');
  if (!roomId) throw new Error('deriveRoomKey: roomId is required');

  const cacheKey = deriveCacheKey(roomSecret, roomId);
  const existing = inflightDerive.get(cacheKey);
  if (existing) return existing;

  const promise = deriveRoomKeyImpl(roomSecret, roomId);
  inflightDerive.set(cacheKey, promise);

  // Clean up the cache entry on settle so future calls can retry (e.g. after
  // a transient Worker error was resolved by a later code path).
  promise.finally(() => {
    if (inflightDerive.get(cacheKey) === promise) {
      inflightDerive.delete(cacheKey);
    }
  });

  return promise;
}

async function deriveRoomKeyImpl(
  roomSecret: string,
  roomId: string,
): Promise<Uint8Array> {
  // Only the Web Worker path is allowed — hash-wasm's WASM would block the
  // main thread for several seconds. If the worker can't run (missing API,
  // script load failure, timeout), we throw immediately rather than falling
  // back to main-thread Argon2id. The caller (buildProvider) handles the
  // error: getYjsSync fails, the timeout wrapper catches it, and the app
  // proceeds without sync. A frozen UI is worse than no sync.
  return deriveRoomKeyViaWorker(roomSecret, roomId);
}

async function deriveRoomKeyViaWorker(
  roomSecret: string,
  roomId: string,
): Promise<Uint8Array> {
  // Vitest/jsdom has no module Worker. Keep the production contract (no
  // main-thread Argon2 fallback) while allowing deterministic crypto unit
  // tests to exercise the AES/HKDF layer in a workerless harness.
  if (typeof Worker === 'undefined') {
    if (import.meta.env.MODE === 'test') {
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${roomId}\0${roomSecret}`),
      );
      return new Uint8Array(digest);
    }
    throw new Error('Worker API unavailable');
  }

  // IMPORTANT: use the literal `new Worker(new URL(...), { type: 'module' })`
  // form. Vite detects module workers via static AST analysis keyed on this
  // exact pattern; routing through a variable (`new WorkerCtor(...)`) defeats
  // that detection, so Vite never emits the worker as a compiled asset and
  // instead inlines the raw `.ts` source as a base64 data URL. The browser
  // then receives uncompiled TypeScript (bare `import "hash-wasm"` specifier,
  // type annotations) as the worker script, which fails to parse and crashes
  // the worker. See the other workers in src/workers/ for the working form.
  const worker = new Worker(
    new URL('./argon2id.worker.ts', import.meta.url),
    { type: 'module' },
  );

  return new Promise<Uint8Array>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Argon2id worker timed out after 10s'));
    }, 10_000);

    worker.onmessage = (event: MessageEvent<{ key?: Uint8Array; error?: string }>) => {
      clearTimeout(timeout);
      worker.terminate();

      if (event.data.error) {
        reject(new Error(`Argon2id worker error: ${event.data.error}`));
      } else if (event.data.key) {
        resolve(event.data.key);
      } else {
        reject(new Error('Argon2id worker returned no key and no error'));
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(
        error instanceof ErrorEvent
          ? new Error(`Argon2id worker crashed: ${error.message}`)
          : new Error('Argon2id worker crashed'),
      );
    };

    worker.postMessage({ secret: roomSecret, roomId });
  });
}

export async function deriveSubKeys(
  roomKey: Uint8Array,
  roomId: string,
): Promise<SubKeys> {
  if (roomKey.length !== ROOM_KEY_BYTES) {
    throw new Error(
      `deriveSubKeys: expected ${ROOM_KEY_BYTES}-byte room key, got ${roomKey.length}`,
    );
  }

  const salt = new TextEncoder().encode(roomId);

  const [stateRaw, fileRaw, authRaw, indexRaw] = await Promise.all([
    hkdfSha256(roomKey, salt, HKDF_INFO_STATE, SUB_KEY_BYTES),
    hkdfSha256(roomKey, salt, HKDF_INFO_FILES, SUB_KEY_BYTES),
    hkdfSha256(roomKey, salt, HKDF_INFO_AUTH, SUB_KEY_BYTES),
    hkdfSha256(roomKey, salt, HKDF_INFO_INDEX, SUB_KEY_BYTES),
  ]);

  const [stateKey, fileKey, manifestAuthKey, roomIndexKey] = await Promise.all([
    crypto.subtle.importKey('raw', stateRaw, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
    crypto.subtle.importKey('raw', fileRaw, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
    // manifestAuthKey is extractable, unlike the other three sub-keys: the
    // delta-log server has no other way to learn what to verify requests
    // against (design.md §4.2 has no separate provisioning endpoint), so the
    // trust-on-first-use registration path (deltaLog/client.ts::registerRoom)
    // exports and sends these raw bytes once. It never decrypts content —
    // unlike stateKey/fileKey/roomIndexKey, its exposure only affects
    // request authentication, not confidentiality.
    crypto.subtle.importKey(
      'raw',
      authRaw,
      { name: 'HMAC', hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    ),
    crypto.subtle.importKey(
      'raw',
      indexRaw,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    ),
  ]);

  return { stateKey, fileKey, manifestAuthKey, roomIndexKey };
}

let stateCounter = randomUint64();
let devicePrefixPromise: Promise<Uint8Array> | null = null;

function getDevicePrefix(): Promise<Uint8Array> {
  if (!devicePrefixPromise) {
    devicePrefixPromise = deriveDevicePrefix();
  }
  return devicePrefixPromise;
}

function randomUint64(): bigint {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const view = new DataView(bytes.buffer);
  return view.getBigUint64(0, false);
}

async function deriveDevicePrefix(): Promise<Uint8Array> {
  let deviceId = '';
  try {
    deviceId =
      typeof localStorage !== 'undefined'
        ? (localStorage.getItem('incrementum_device_id') ?? '')
        : '';
  } catch {
    // localStorage unavailable (test context, sandboxed iframe) — fall through to random.
  }
  if (!deviceId) {
    const random = new Uint8Array(NONCE_DEVICE_PREFIX_BYTES);
    crypto.getRandomValues(random);
    return random;
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceId));
  return new Uint8Array(digest).slice(0, NONCE_DEVICE_PREFIX_BYTES);
}

function nextStateNonce(devicePrefix: Uint8Array): Uint8Array {
  if (stateCounter >= 0xffffffffffffffffn) {
    throw new Error('state-encryption counter exhausted; restart the app');
  }
  const counter = stateCounter;
  stateCounter += 1n;

  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  nonce.set(devicePrefix, 0);
  const view = new DataView(nonce.buffer, NONCE_DEVICE_PREFIX_BYTES, NONCE_COUNTER_BYTES);
  view.setBigUint64(0, counter, false);
  return nonce;
}

/**
 * Pack `nonce || ciphertext+tag` into one buffer. Shared by encryptState
 * (counter nonce for ordered sync updates) and encryptFile (random nonce for
 * whole-file blobs). The packed format is what both the state and file
 * transports put on the wire.
 */
async function sealAesGcm(
  plaintext: Uint8Array,
  nonce: Uint8Array,
  key: CryptoKey,
): Promise<Uint8Array> {
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext),
  );
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

/**
 * Unpack and decrypt a `nonce || ciphertext+tag` buffer. Throws DecryptError
 * on any failure (wrong key, tampering, truncated payload).
 */
async function openAesGcm(
  packed: Uint8Array,
  key: CryptoKey,
  label: string,
): Promise<Uint8Array> {
  if (packed.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new DecryptError(`${label}: payload too short`);
  }
  const nonce = packed.slice(0, AES_GCM_NONCE_BYTES);
  const ciphertext = packed.slice(AES_GCM_NONCE_BYTES);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext),
    );
  } catch {
    throw new DecryptError(`${label}: decryption failed (wrong key or tampering)`);
  }
}

export async function encryptState(
  update: Uint8Array,
  stateKey: CryptoKey,
): Promise<Uint8Array> {
  const devicePrefix = await getDevicePrefix();
  const nonce = nextStateNonce(devicePrefix);
  return sealAesGcm(update, nonce, stateKey);
}

export async function decryptState(
  packed: Uint8Array,
  stateKey: CryptoKey,
): Promise<Uint8Array> {
  return openAesGcm(packed, stateKey, 'decryptState');
}

/**
 * Encrypt a whole file blob under the file sub-key with a fresh random nonce.
 * Returns `nonce(12) || ciphertext+tag`. This is the format the file-service
 * stores verbatim — the server never sees the nonce separately or the
 * plaintext. Used by `uploadRoomFile` before POSTing.
 *
 * Unlike `encryptState`, the nonce is fully random rather than counter-based:
 * file uploads are infrequent and not ordered, and a random nonce avoids any
 * dependency on per-device counter state for blob confidentiality.
 */
export async function encryptFile(
  plaintext: Uint8Array,
  fileKey: CryptoKey,
): Promise<Uint8Array> {
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return sealAesGcm(plaintext, nonce, fileKey);
}

export async function decryptFile(
  packed: Uint8Array,
  fileKey: CryptoKey,
): Promise<Uint8Array> {
  return openAesGcm(packed, fileKey, 'decryptFile');
}

/**
 * Encrypt a JSON-serializable metadata object (filename, content-type, etc.)
 * under the file key. Returns base64 so it fits cleanly in a multipart form
 * field or HTTP header alongside the ciphertext blob. The server stores this
 * opaquely and never decrypts — the client recovers filename/type on download.
 */
export async function encryptMetadata(
  metadata: unknown,
  fileKey: CryptoKey,
): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const packed = await encryptFile(json, fileKey);
  return bytesToBase64(packed);
}

export async function decryptMetadata(
  packedB64: string,
  fileKey: CryptoKey,
): Promise<unknown> {
  const packed = base64ToBytes(packedB64);
  const json = await decryptFile(packed, fileKey);
  return JSON.parse(new TextDecoder().decode(json));
}

export async function encryptChunk(
  plaintext: Uint8Array,
  fileKey: CryptoKey,
): Promise<EncryptedChunk> {
  const nonce = new Uint8Array(AES_GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, fileKey, plaintext),
  );
  return { nonce, ciphertext };
}

export async function decryptChunk(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  fileKey: CryptoKey,
): Promise<Uint8Array> {
  if (nonce.length !== AES_GCM_NONCE_BYTES) {
    throw new DecryptError(
      `decryptChunk: expected ${AES_GCM_NONCE_BYTES}-byte nonce, got ${nonce.length}`,
    );
  }
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, fileKey, ciphertext),
    );
  } catch {
    throw new DecryptError('decryptChunk: decryption failed (wrong key or tampering)');
  }
}

/**
 * Delta-log key tag (design.md §3): `HMAC-SHA256(roomIndexKey, domain ||
 * 0x00 || entityKey)`. Stable for a given (room, domain, entityKey) triple,
 * opaque, and non-correlatable across rooms since each room derives its own
 * `roomIndexKey`. The server uses this — and only this — to order and
 * compact operations for one entity without ever learning what that entity
 * is or which domain it belongs to.
 */
export async function keyTag(
  domain: string,
  entityKey: string,
  roomIndexKey: CryptoKey,
): Promise<Uint8Array> {
  const message = concatBytes(
    new TextEncoder().encode(domain),
    new Uint8Array([0]),
    new TextEncoder().encode(entityKey),
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', roomIndexKey, message));
}

export interface SignedRequest {
  timestamp: number;
  signature: string;
}

const DEFAULT_REQUEST_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Sign a delta-log request: `HMAC(manifestAuthKey, method || path || body ||
 * timestamp)`. Every field the server can observe is covered, so tampering
 * with any of them (including the timestamp, which anchors the replay
 * window — see {@link verifyRequestSignature}) invalidates the signature.
 */
export async function signRequest(
  method: string,
  path: string,
  body: Uint8Array | string,
  manifestAuthKey: CryptoKey,
  timestamp: number = Date.now(),
): Promise<SignedRequest> {
  const message = buildSignedRequestMessage(method, path, toBytes(body), timestamp);
  const mac = await crypto.subtle.sign('HMAC', manifestAuthKey, message);
  return { timestamp, signature: bytesToHex(new Uint8Array(mac)) };
}

/**
 * Verify a signed delta-log request. Rejects if the signature doesn't match
 * (tampered method/path/body/timestamp) or if `timestamp` is outside
 * `maxSkewMs` of `now` (default 5 minutes) — the replay window: a captured
 * request cannot be replayed indefinitely, only within that skew.
 */
export async function verifyRequestSignature(
  method: string,
  path: string,
  body: Uint8Array | string,
  signed: SignedRequest,
  manifestAuthKey: CryptoKey,
  options: { now?: number; maxSkewMs?: number } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const maxSkewMs = options.maxSkewMs ?? DEFAULT_REQUEST_MAX_SKEW_MS;
  if (Math.abs(now - signed.timestamp) > maxSkewMs) return false;

  const message = buildSignedRequestMessage(method, path, toBytes(body), signed.timestamp);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = hexToBytes(signed.signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', manifestAuthKey, signatureBytes, message);
}

function buildSignedRequestMessage(
  method: string,
  path: string,
  body: Uint8Array,
  timestamp: number,
): Uint8Array {
  return concatBytes(
    new TextEncoder().encode(method.toUpperCase()),
    new Uint8Array([0]),
    new TextEncoder().encode(path),
    new Uint8Array([0]),
    new TextEncoder().encode(String(timestamp)),
    new Uint8Array([0]),
    body,
  );
}

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : body;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hexToBytes: odd-length string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hexToBytes: invalid hex');
    out[i] = byte;
  }
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export async function hmacManifest(
  entryBytes: Uint8Array,
  manifestAuthKey: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', manifestAuthKey, entryBytes),
  );
}

export async function verifyManifestHmac(
  entryBytes: Uint8Array,
  expectedMac: Uint8Array,
  manifestAuthKey: CryptoKey,
): Promise<boolean> {
  return crypto.subtle.verify('HMAC', manifestAuthKey, expectedMac, entryBytes);
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    baseKey,
    length * 8,
  );
  return new Uint8Array(bits);
}

// base64 (standard alphabet, with padding) helpers for metadata framing.
// Standard rather than url-safe because the value travels in a multipart
// form field / header, both of which tolerate '+' and '/'.
function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export const __test = {
  AES_GCM_NONCE_BYTES,
  NONCE_DEVICE_PREFIX_BYTES,
  NONCE_COUNTER_BYTES,
  resetStateCounterForTesting(): void {
    stateCounter = randomUint64();
  },
  resetDevicePrefixForTesting(): void {
    devicePrefixPromise = null;
  },
  async getStateNoncePrefixForTesting(): Promise<Uint8Array> {
    return getDevicePrefix();
  },
};
