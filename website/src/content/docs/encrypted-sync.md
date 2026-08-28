---
title: "End-to-End Encrypted Cloud Sync"
description: "Plethora Pro delta sync with client-side AES-GCM encryption over authenticated HTTPS push/pull."
category: "settings-privacy-troubleshooting"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["cloud sync","delta sync","end to end encryption","cross device sync"]
aliases: ["cloud sync","delta sync","end to end encryption","cross device sync"]
relatedDocs: ["settings.themes","security.privacy_toggle","reader.position.restore"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/settings/encrypted-sync.md"
---
# End-to-End Encrypted Cloud Sync

## Purpose
Synchronizes documents, extracts, flashcards, reading positions, and review histories across devices using an encrypted outbox journal and server-side delta storage.

## User-Facing Behavior
- Sync status in Settings shows pending changes, last sync time, storage usage, and errors.
- Background sync runs after local edits, on app resume, when connectivity returns, and periodically.
- Offline-first: study offline; changes merge when you reconnect.

## Exact Behavioral Rules
1. Local mutations are journaled in SQLite before commit; sync pushes encrypted deltas in batches.
2. All sync payloads are encrypted on-device with AES-GCM before upload; the server stores only ciphertext.
3. Conflicts surface as sync issues with keep mine / keep theirs / keep both resolution.
4. Plethora Pro entitlement is required.

## Rationale
Total data privacy and sovereignty with modern multi-device convenience — without real-time CRDT relays.
