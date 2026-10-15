## Why

End-to-end encryption for cross-device sync is fully built and deployed — the room-key derivation, AES-GCM state encryption, ciphertext-only file blobs, and the zero-knowledge relay (which already refuses plaintext sync frames at `yjs-sync/utils.js`) are all in place. But it is **opt-in per room**: a user has to find the "Enable encryption" button in Sync settings and click it. Most users never will, so most rooms today run in "TLS only" mode — meaning the relay sees plaintext reading state, flashcards, and uploaded-file metadata. That is the exact outcome the encryption layer was built to prevent, and it is the opposite of what users expect from a tool that advertises privacy.

Encryption should not be a step the user has to enable. It should be on by default, and the relay should have zero knowledge of the synced content in every room, automatically.

## What Changes

### Encryption becomes automatic and non-optional
- `buildProvider()` in `src/lib/yjsSync.ts` no longer falls back to a plaintext `WebsocketProvider` when no room key is cached. Instead it calls `ensureEncryptionEnabled(roomId)` to silently generate a 32-byte secret, derive the room key via Argon2id, and persist both to the OS keychain (Tauri) or encrypted IndexedDB (web), then builds the `EncryptedWebsocketProvider`. Encryption is on by default; there is no opt-in.
- If provisioning fails (e.g. the keychain is genuinely unavailable), `buildProvider` throws rather than silently degrading to plaintext. The relay refuses plaintext frames anyway, so a plaintext fallback would have been a dishonest "success".
- The "TLS only" mode is gone for new sync sessions.

### Pairing UI replaces the encryption toggle
- `src/components/settings/SyncSettings.tsx` removes the "Enable encryption" / "Disable encryption" toggle entirely. There is nothing to opt into.
- The panel keeps the **room secret** display (show/hide, copy) — that is how the user pairs another device (QR or manual copy). It keeps the **Reset key** control, reframed as rotation, for re-keying a compromised room.
- The QR always carries the full `incrementum-sync:v1:<roomId>:<secret>` payload, because encryption is always on.
- The "Join another code" field accepts only the full invite payload now. A bare room ID cannot pair (each device would auto-provision a different key and never decrypt the peer's frames), so the UI guides the user toward the invite code / QR instead of silently joining an incompatible room.

### The Real-time sync on/off toggle stays
Users can still turn cloud sync off entirely (bandwidth, privacy preference). The change is only that *when sync is on*, it is encrypted — automatically, with no separate step.

## Impact

**Affected code (frontend)**
- `src/lib/yjsSync.ts` — `buildProvider` auto-provisions and never falls back to plaintext; updated doc comment.
- `src/lib/sync/roomCrypto.ts` — new `ensureEncryptionEnabled(roomId)` helper (idempotent: returns cached secret if present, else provisions).
- `src/components/settings/SyncSettings.tsx` — encryption toggle removed; pairing UI retained; `handleRotateRoom` auto-provisions for the new room; `handleJoinRoom` requires the full invite payload; QR always includes the secret.
- `src/lib/i18n/locales/en.ts` — new keys (`syncSettings.needInviteCodeMsg`, `syncSettings.e2eLoadingSecret`); a few keys become unused (`statusTlsOnly`, `e2eEnable`, `e2eDisable`, `e2eDisabledDesc`) and are left in place for translation stability.

**Affected tests**
- `src/lib/__tests__/yjsSync.rejoin.test.ts` — mocks updated to reflect the always-encrypted provider branch.
- `src/lib/__tests__/yjsSync.encryptionDefault.test.ts` — new: pins the contract that `buildProvider` is always encrypted and auto-provisions exactly once.
- `src/components/settings/__tests__/SyncSettings.join.test.tsx` — bare room ID is now rejected; full invite code joins.

**Unchanged**
- All crypto primitives (`encryption.ts`), the transport wrapper (`encryptedProvider.ts`), secure storage (`secureStorage.ts`), and the QR format (`qrFormat.ts`).
- The relay (`yjs-sync/`) — it already forwards only ciphertext and refuses plaintext sync frames; no relay change is needed.
- The deprecated JWT/Postgres REST sync path.
- Awareness/presence (remains plaintext; ephemeral, carries no document content).

## Migration / back-compat
- Existing devices with a cached room key are unaffected — they take the cached-key branch.
- Existing rooms that were running in "TLS only" mode get **fixed** on upgrade: the device provisions a key, and from then on the relay sees only ciphertext. To pair another device into such a room, the user copies the freshly-provisioned secret (shown in Sync settings) — one-time pairing cost in exchange for the room finally being encrypted.
- Re-pairing is required for any room whose secret the user does not have cached. This is the same key-recovery property as today (lost secret = cannot add new devices); it is documented in `design.md`.

## Risks
- **Key recovery.** A lost room secret means a new device cannot be paired into the room. This is inherent to true E2EE (the relay cannot help) and was already the case for users who enabled encryption manually. Escrow / recovery codes are out of scope here and tracked as a separate concern.
- **Pairing friction for existing "TLS only" rooms.** Upgrading such a room to encrypted requires re-pairing devices with the new secret. The UI surfaces the secret prominently; no silent data loss occurs (each device keeps its local replica).
