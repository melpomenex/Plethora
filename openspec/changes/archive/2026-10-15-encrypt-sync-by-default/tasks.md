## 1. Encryption auto-provisioning

- [x] 1.1 Add `ensureEncryptionEnabled(roomId)` to `src/lib/sync/roomCrypto.ts` — returns the cached secret if present, else calls `enableEncryption(roomId)` and returns the new secret. Idempotent.
- [x] 1.2 Rework `buildProvider()` in `src/lib/yjsSync.ts`: on missing cached sub-keys, call `ensureEncryptionEnabled(room)`, re-read sub-keys, and build the `EncryptedWebsocketProvider`. Throw (do not fall back to plaintext) if sub-keys are still absent after provisioning. Update the doc comment.
- [x] 1.3 Import `ensureEncryptionEnabled` in `yjsSync.ts` (replace the `getCachedSubKeys`-only import).

## 2. Settings UI

- [x] 2.1 In `src/components/settings/SyncSettings.tsx`, remove the `SYNC_ENCRYPTION_UI_ENABLED` flag, the `encryptionEnabled` / `encryptionStatusLabel` state, and the `LockOpen` import.
- [x] 2.2 Remove `handleEnableEncryption` and `handleDisableEncryption`; rename `handleResetEncryption` → `handleRotateKey` (kept for re-keying a room).
- [x] 2.3 Replace the encryption controls block with an always-encrypted pairing panel: green-lock header, "Encrypted" status, room secret (show/hide/copy), Rotate key button, loading state before the secret loads.
- [x] 2.4 On mount, call `ensureEncryptionEnabled(room)` (via `loadRoomSecret`) so the secret is populated for the QR on a fresh device.
- [x] 2.5 `handleRotateRoom`: auto-provision for the new room via `ensureEncryptionEnabled(next)` and reveal the new secret (instead of clearing encryption).
- [x] 2.6 `handleJoinRoom`: reject a bare room ID with a guiding message; accept the full `incrementum-sync:v1:<roomId>:<secret>` payload only.
- [x] 2.7 QR payload always uses `encodeSyncQrPayload(roomId, roomSecret)` (encryption is always on).

## 3. i18n

- [x] 3.1 Add `syncSettings.needInviteCodeMsg` and `syncSettings.e2eLoadingSecret` to `src/lib/i18n/locales/en.ts`.
- [x] 3.2 Leave now-unused keys (`statusTlsOnly`, `e2eEnable`, `e2eDisable`, `e2eDisabledDesc`, `encryptionEnabledMsg`, etc.) in place for translation stability.

## 4. Tests

- [x] 4.1 Update `src/lib/__tests__/yjsSync.rejoin.test.ts`: `getCachedSubKeys` mock returns non-null sub-keys; `EncryptedWebsocketProvider` mock delegates to `MockWebsocketProvider` so room/construction tracking keeps working.
- [x] 4.2 Update `src/components/settings/__tests__/SyncSettings.join.test.tsx`: bare room ID is rejected; full invite code joins; roomCrypto mock exports `ensureEncryptionEnabled`.
- [x] 4.3 Add `src/lib/__tests__/yjsSync.encryptionDefault.test.ts` pinning: provider is encrypted when a key is cached; auto-provision fires exactly once on a fresh device and builds encrypted; no plaintext provider is ever constructed when sync is enabled; provisioning failure throws rather than degrading to plaintext.

## 5. Documentation

- [x] 5.1 `openspec/changes/encrypt-sync-by-default/proposal.md`, `design.md`, `tasks.md`.

## 6. Verification

- [x] 6.1 `npm run lint` / typecheck passes on changed files.
- [x] 6.2 Affected vitest suites pass (`yjsSync.rejoin`, `yjsSync.encryptionDefault`, `SyncSettings.join`).
- [x] 6.3 Existing crypto tests remain green (`sync.encryption`, `sync.encryptedProvider`, `sync.secureStorage`) — primitives are unchanged.
