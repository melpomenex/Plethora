---
id: sync.yjs_cloud
title: End-to-End Encrypted Cloud Sync
domain: settings
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Plethora Pro delta sync with client-side AES-GCM encryption over authenticated HTTPS push/pull.
how_to: Open Settings → Sync. Sign in with Plethora Pro, generate a recovery key, and tap Sync Now.
why: Knowledge must be accessible everywhere without trusting third-party cloud providers with unencrypted reading materials and personal notes.
aliases:
  - cloud sync
  - delta sync
  - end to end encryption
  - cross device sync
settings:
  - sync.enabled
actions:
  - id: settings.sync.cloud
    label: Open Sync Settings
    shortcut: Alt+,
related:
  - settings.themes
  - security.privacy_toggle
  - reader.position.restore
---

# End-to-End Encrypted Cloud Sync

## Purpose
Synchronizes documents, extracts, flashcards, reading positions, and review histories across devices using an encrypted outbox journal and server-side delta storage.

## User-Facing Behavior
- Sync status in Settings shows pending changes, last sync time, storage usage, and errors.
- Background sync runs after local edits (debounced), on app resume, when connectivity returns, and on a periodic interval.
- Offline-first: study offline; changes merge when you reconnect.

## Exact Behavioral Rules
1. Local mutations are journaled in SQLite before commit; sync pushes encrypted deltas in batches.
2. All sync payloads are encrypted on-device with AES-GCM before upload; the server stores only ciphertext.
3. Conflicts surface as sync issues with keep mine / keep theirs / keep both resolution.
4. Plethora Pro entitlement is required; free accounts see an upgrade prompt.

## Rationale
Total data privacy and sovereignty with modern multi-device convenience — without real-time CRDT relays.

## Platform Behavior
- **All Platforms**: Encrypted delta sync over HTTPS to Plethora Cloud (`/v1/sync`, `/v1/blobs`).
