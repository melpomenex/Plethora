# Design: Encrypt Sync By Default

## Context

The cross-device sync stack (`openspec/changes/overhaul-cross-device-sync/`) ships a complete E2EE layer: Argon2id room-key derivation, HKDF sub-keys, AES-GCM state encryption under the state sub-key, ciphertext-only file blobs under the file sub-key, and a forked relay that forwards only opaque type-`0x10` frames and refuses plaintext type-0 sync frames (`yjs-sync/utils.js` `messageListener`). Secure storage is OS keychain on Tauri and encrypted IndexedDB on web.

The gap is policy, not cryptography. Encryption is opt-in per room: `buildProvider()` in `src/lib/yjsSync.ts` builds a plaintext `WebsocketProvider` unless a key is cached, and the user has to click "Enable encryption" in Sync settings to cache one. As a result most rooms today are "TLS only" — the relay sees plaintext reading state, flashcards, and uploaded-file metadata.

This change makes encryption automatic and non-optional: a room key is provisioned on first sync, and there is no plaintext fallback.

## Goals / non-goals

**Goals**
- Encryption is on by default; users never have to enable it.
- The relay has zero knowledge of synced content in every room, automatically.
- Pairing other devices stays straightforward (QR or copied invite code carries room + secret).
- Users can still turn cloud sync off entirely via the existing Real-time sync toggle.

**Non-goals**
- No changes to crypto primitives, the transport wrapper, secure storage, or the relay. The cryptography is done; this change is wiring + UI.
- No key recovery / escrow flow. Lost secret = cannot pair new devices, same as today for users who manually enabled encryption. Tracked separately.
- No change to awareness/presence handling (remains plaintext; ephemeral, no document content).
- No change to the deprecated JWT/Postgres REST sync path.

## Decision: auto-provision inside `buildProvider`

`buildProvider(url, room, doc)` is the single chokepoint where every sync session constructs its provider. Today it branches:

```
subKeys = getCachedSubKeys(room)
if (!subKeys) return new WebsocketProvider(url, room, doc, { connect: true })  // plaintext fallback
return new EncryptedWebsocketProvider(...).provider
```

The new logic:

```
subKeys = getCachedSubKeys(room)
if (!subKeys) {
  ensureEncryptionEnabled(room)        // generate secret + derive key + persist
  subKeys = getCachedSubKeys(room)
}
if (!subKeys) throw                    // do NOT fall back to plaintext
return new EncryptedWebsocketProvider(...).provider
```

Rationale:
- **Single chokepoint.** Every entry path — initial boot (`getYjsSync`), URL change / toggle (`updateYjsSyncStatus`), and room switch (`rejoinRoom`) — funnels through `buildProvider`. Provisioning here covers all of them; there is no separate "fresh device" path to forget.
- **No plaintext fallback.** The relay already drops type-0 plaintext sync frames (`yjs-sync/utils.js`, `case messageSync: break`). A plaintext provider would silently fail to replicate. Treating "no key" as an error rather than a degraded mode keeps the system honest and surfaces genuine keychain failures instead of masking them.
- **Silent provisioning.** `enableEncryption(roomId)` generates a 32-byte random secret (256-bit entropy), derives the room key with Argon2id, and persists both. This is invisible to the user on a fresh device; the secret only surfaces when they open Sync settings to pair another device.

`ensureEncryptionEnabled(roomId)` (new in `roomCrypto.ts`) wraps the "check then provision" dance so callers don't repeat it: returns the cached secret if present, else provisions and returns the new secret. Idempotent.

## Decision: keep the Real-time sync on/off toggle, remove only the encryption toggle

Per the product requirement ("encryption shouldn't be a step the user enables"), the encryption enable/disable controls are removed. The status is always "Encrypted".

The Real-time sync toggle is preserved because it answers a different question — "do you want cloud sync at all?" Users on metered connections, or who simply prefer local-only operation, need an off switch. Removing it would leave them no in-app way to disable sync.

When sync is off, `getYjsSync` still constructs a `WebsocketProvider` with `{ connect: false }` (the offline-only branch at `yjsSync.ts:220`). That path is unchanged and does not need a key — nothing leaves the device.

## Decision: pairing via invite code, not bare room ID

With per-room auto-provisioning, two devices that each independently auto-provision will end up with different keys and be unable to decrypt each other's frames. So a bare room ID can no longer pair a new device — the joining device needs the room's secret too.

The QR format already carries both (`incrementum-sync:v1:<roomId>:<secret>` in `qrFormat.ts`), and the QR is now always generated with the secret (encryption is always on). The manual "Join another code" field rejects a bare room ID with a guiding message and accepts the full invite payload. The scan path is unchanged (it always scanned for the full payload).

## Backward compatibility

| Starting state | On upgrade |
|---|---|
| Device has a cached room key (already encrypted) | Unchanged — takes the cached-key branch. |
| Device in a "TLS only" room (no cached key) | Provisions a key; relay starts seeing ciphertext. To pair other devices into that room, the user copies the freshly-provisioned secret from Sync settings. One-time pairing cost in exchange for the room finally being encrypted. |
| Device with sync disabled | Unchanged — offline-only provider, no key needed. |

No data is lost on upgrade: each device keeps its local replica, and the shared Yjs doc merges as peers reconnect.

## Key recovery

A lost room secret cannot be recovered — the relay is zero-knowledge, so it cannot help. A device that loses its secret can still read its local replica but cannot pair new devices into the old room. The recovery path is: rotate the room key (Reset key in Sync settings, which generates a new secret + key) and re-pair the other devices with the new secret. This is the same property as today for users who manually enabled encryption; this change does not make it worse, it just makes it apply to all rooms.

A recovery-code / escrow flow is a deliberate non-goal here and would be a separate change.

## Security properties (unchanged from the underlying E2EE layer, restated for clarity)

- **State sync:** AES-GCM under an HKDF "state-v1" sub-key; relay sees type-`0x10` ciphertext only.
- **File blobs:** AES-GCM under the "files-v1" sub-key with a random per-upload nonce; file-service stores `.bin` ciphertext + encrypted-metadata sidecar only.
- **File metadata (filename, content-type):** encrypted as a base64 blob in the `X-Encrypted-Metadata` header; file-service stores it verbatim, never decrypts.
- **Manifest integrity:** HMAC under the "auth-v1" sub-key.
- **Key derivation:** Argon2id (64 MiB, 3 iterations, parallelism 4) from a 32-byte random secret + roomId.
- **Awareness/presence:** plaintext, ephemeral, no document content (out of scope by design).
