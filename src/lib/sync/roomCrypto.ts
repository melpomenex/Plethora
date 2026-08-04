/**

 Orchestration helper for the per-room encryption setup. Wraps the three
 lower-level pieces (secret generation, Argon2id key derivation, secure
 storage of both) behind a small API the UI can call without touching
 crypto primitives directly.

 Flow:
   1. User clicks "Enable encryption" → UI calls `enableEncryption(roomId)`
      or `enableEncryptionWithSecret(roomId, userChosenSecret)`.
   2. This module generates (or accepts) the room secret, derives the
      32-byte room key via Argon2id, and persists BOTH to secure storage.
   3. On next app launch, `yjsSync.ts` calls `getCachedSubKeys(roomId)` to
      get the derived AES-GCM state key; if present, it constructs the
      EncryptedWebsocketProvider. If absent, sync runs in "TLS only" mode.
   4. User clicks "Disable" → `disableEncryption()` clears both records.

*/

import { deriveRoomKey, deriveSubKeys, type SubKeys } from './encryption';
import {
  setCachedRoomKey,
  getCachedRoomKey,
  clearAllCachedSyncCrypto,
  setCachedRoomSecret,
  getCachedRoomSecret,
  setCachedRoomBinding,
  getCachedRoomBinding,
  clearCachedRoomBinding,
} from './secureStorage';

const GENERATED_SECRET_BYTES = 32;
const BINDING_CONTEXT = new TextEncoder().encode('incrementum-sync/room-binding-v1');

/**
 * Generate a fresh 32-byte room secret, base64url-encoded for display/QR.
 * This is the recommended path — a random 256-bit secret has far higher
 * entropy than any user-chosen passphrase and avoids Argon2id's main
 * defense (offline brute force) mattering at all.
 */
export function generateRoomSecret(): string {
  const bytes = new Uint8Array(GENERATED_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

/**
 * Enable encryption on this device for the given room, using a
 * freshly-generated strong secret. Persists both the secret and the derived
 * key. Returns the secret so the UI can display it for the user to share
 * (via QR or copy) with their other devices.
 */
export async function enableEncryption(roomId: string): Promise<string> {
  if (!roomId) throw new Error('enableEncryption: roomId is required');
  const secret = generateRoomSecret();
  await persistSecretAndKey(secret, roomId);
  return secret;
}

/**
 * Enable encryption using a user-provided secret (passphrase or
 * previously-shared key string). Use this when joining an existing
 * encrypted room — the secret comes from the QR code or manual entry.
 */
export async function enableEncryptionWithSecret(
  roomId: string,
  secret: string,
): Promise<void> {
  if (!roomId) throw new Error('enableEncryptionWithSecret: roomId is required');
  if (!secret) throw new Error('enableEncryptionWithSecret: secret is required');
  await persistSecretAndKey(secret, roomId);
}

async function persistSecretAndKey(secret: string, roomId: string): Promise<void> {
  const roomKey = await deriveRoomKey(secret, roomId);
  const binding = await computeRoomBinding(secret, roomId, roomKey);

  // Invalidate the commit marker before changing either record. If the app is
  // killed between writes, the next boot sees the missing/mismatched binding
  // and deterministically rebuilds the key from the shareable secret.
  await clearCachedRoomBinding();
  await setCachedRoomSecret(secret);
  await setCachedRoomKey(roomKey);
  await setCachedRoomBinding(binding);
}

/**
 * Disable encryption on this device. Clears both the cached secret and the
 * derived key. Does NOT change the room ID — sync continues the "TLS only"
 * mode against the same room.
 */
export async function disableEncryption(): Promise<void> {
  await clearAllCachedSyncCrypto();
}

/**
 * Returns true if a derived room key is cached on this device (encryption
 * will be active on next yjsSync init). Cheaper than `getCachedSubKeys`
 * when the UI just wants a boolean.
 */
export async function isEncryptionEnabled(): Promise<boolean> {
  const key = await getCachedRoomKey();
  return key !== null;
}

/**
 * Guarantee encryption is enabled on this device for the given room. Returns
 * the room secret (the user-shareable string for pairing other devices via
 * QR or copy).
 *
 * - If a room key is already cached, returns the cached secret unchanged.
 * - If not, generates a fresh strong secret, derives the room key via
 *   Argon2id, and persists both to secure storage, then returns the secret.
 *
 * Encryption is mandatory for sync (the relay refuses plaintext sync frames),
 * so the boot path and room-join path call this to provision silently rather
 * than asking the user to opt in. Idempotent: provisioning runs at most once
 * per device; subsequent calls short-circuit on the cached key.
 */
export async function ensureEncryptionEnabled(roomId: string): Promise<string> {
  if (!roomId) throw new Error('ensureEncryptionEnabled: roomId is required');
  const [existingSecret, existingKey, existingBinding] = await Promise.all([
    getCachedRoomSecret(),
    getCachedRoomKey(),
    getCachedRoomBinding(),
  ]);

  if (existingSecret && existingKey && existingBinding) {
    const expectedBinding = await computeRoomBinding(existingSecret, roomId, existingKey);
    if (constantTimeEqual(existingBinding, expectedBinding)) {
      return existingSecret;
    }
  }

  if (existingSecret) {
    console.warn(
      '[roomCrypto] cached room secret/key binding missing or inconsistent; repairing derived key',
    );
    await persistSecretAndKey(existingSecret, roomId);
    return existingSecret;
  }

  return enableEncryption(roomId);
}

/**
 * Load the cached room secret (for QR generation) or null if none cached.
 */
export async function getCachedRoomSecretOrNull(): Promise<string | null> {
  return getCachedRoomSecret();
}

/**
 * Derive the full sub-key set from the cached room key. Returns null if no
 * key is cached (caller should fall back to plain WebsocketProvider).
 *
 * This is the entry point yjsSync.ts uses at provider-construction time.
 * Argon2id is NOT re-run here — the room key is already cached; we only
 * run HKDF, which is fast.
 */
export async function getCachedSubKeys(roomId: string): Promise<SubKeys | null> {
  const roomKey = await getCachedRoomKey();
  if (!roomKey) return null;
  return deriveSubKeys(roomKey, roomId);
}

// --- internal helpers ---

function bytesToBase64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function computeRoomBinding(
  secret: string,
  roomId: string,
  roomKey: Uint8Array,
): Promise<Uint8Array> {
  const roomBytes = new TextEncoder().encode(roomId);
  const secretBytes = new TextEncoder().encode(secret);
  const payload = new Uint8Array(
    BINDING_CONTEXT.length + roomBytes.length + secretBytes.length + roomKey.length + 3,
  );
  let offset = 0;
  payload.set(BINDING_CONTEXT, offset);
  offset += BINDING_CONTEXT.length + 1;
  payload.set(roomBytes, offset);
  offset += roomBytes.length + 1;
  payload.set(secretBytes, offset);
  offset += secretBytes.length + 1;
  payload.set(roomKey, offset);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
