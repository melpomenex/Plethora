## ADDED Requirements

### Requirement: Sync is record-based, cursor-paged, and bounded
Sync SHALL exchange typed per-row records (`SyncRecord`) via `POST /v1/sync/push` (idempotent batches keyed by device+HLC) and `GET /v1/sync/pull?cursor=` (server-sequence paged). Pull pages SHALL be hard-capped (default 500 records / 8 MB) and applied streaming — never materializing a full account state in memory. Sync SHALL NOT run on the startup critical path; the engine initializes lazily and first flush is idle-scheduled.

#### Scenario: Large backlog does not blow memory
- **WHEN** a device with a 50k-record backlog pulls after long offline use
- **THEN** peak PSS stays within the memory-budget ceiling and the UI remains interactive

#### Scenario: Startup is never blocked
- **WHEN** the app launches with sync enabled and the network is slow
- **THEN** time-to-interactive matches the sync-disabled baseline within existing memory/perf gates

### Requirement: Payloads are end-to-end encrypted with epoch-scoped keys
All record payloads SHALL be AES-256-GCM encrypted client-side under per-collection keys derived (HKDF) from an epoch-scoped `SyncMasterKey`, with AAD binding account, table kind, record id, HLC, and epoch. The server SHALL store only ciphertext and envelope metadata; zero plaintext at rest or in logs (test-enforced). Device revocation SHALL rotate the epoch such that revoked devices cannot decrypt subsequent pushes.

#### Scenario: Server never sees content
- **WHEN** an inspector scans server storage and logs after sustained syncing
- **THEN** no readable document/extract/settings content is present

#### Scenario: AAD tampering rejected
- **WHEN** a ciphertext is replayed against a different record id or epoch
- **THEN** decryption fails and the record is quarantined with an integrity event

### Requirement: Enrollment uses pairing; recovery uses the RecoveryKey
New devices SHALL enroll by a pairing approval from an existing device (QR or 6-digit code) wrapping the master key to the new device's public key. Users SHALL receive a one-time RecoveryKey (word list) able to restore sync access on any signed-in device. Losing both the RecoveryKey and all enrolled devices SHALL leave cloud data unrecoverable (explicit user acknowledgment required).

#### Scenario: Fresh device enrolls by pairing
- **WHEN** the user scans the pairing QR on a new device
- **THEN** the device gains sync access without the server learning any key material

#### Scenario: Revoked device cannot re-enroll
- **WHEN** a revoked device attempts to pull after epoch rotation
- **THEN** its requests fail with re-enrollment required and its local data remains intact

### Requirement: Merge semantics are deterministic per table kind
Document/Extract/Setting merges SHALL use field-level LWW by HLC; review history SHALL be append-only union deduplicated by deterministic ids; collections/tags SHALL be additive union with tombstone-wins deletion. Lossy conflicts (concurrent meaningful edits to the same record) SHALL surface in a sync issues list with explicit resolution (keep mine / keep theirs / both) rather than silent discard.

#### Scenario: Reviews union across devices
- **WHEN** two devices review the same card offline and sync
- **THEN** both review results exist exactly once and scheduling reflects the deterministic replay

#### Scenario: Deletion never resurrects
- **WHEN** a document deleted on device A syncs with device B that edited it offline
- **THEN** the tombstone wins for the record while B's child edits are preserved or surfaced per rules — the document does not reappear

### Requirement: Sync covers application state comprehensively
The sync domain SHALL include reading positions (`position_json`), extracts/notes/highlights, learning items and scheduling state, review history, collections/categories/tags, whitelisted settings, RSS/podcast state, image-asset metadata, and deletion tombstones. Document binaries SHALL sync only opt-in (per document/collection) under the storage quota. AI provider keys and device-local settings SHALL NOT sync.

#### Scenario: Opt-in binary sync respects quota
- **WHEN** a user enables binary sync for large PDFs beyond the storage envelope
- **THEN** uploads stop at the quota boundary with a clear quota-reason surface

### Requirement: Sync failure never impairs local use
Offline, timeout, server outage, revoked session, quota exhaustion, and corrupt-response conditions SHALL degrade to queued-later or disabled-with-reason states; local reading, review, and data creation SHALL be unaffected in every case.

#### Scenario: Server maintenance mid-sync
- **WHEN** the sync server is unreachable for days
- **THEN** the app operates fully locally, queues bounded changes, and resumes cleanly on reconnect
