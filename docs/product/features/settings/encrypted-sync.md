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
summary: Yjs CRDT real-time synchronization with client-side AES-GCM encryption over WebSocket relays or self-hosted servers.
how_to: Open Settings → Sync. Enter your private sync passkey or connect to a custom Yjs relay server. All devices sync automatically.
why: Knowledge must be accessible everywhere without trusting third-party cloud providers with unencrypted reading materials and personal notes.
aliases:
  - cloud sync
  - yjs sync
  - end to end encryption
  - crdt sync
  - cross device sync
settings:
  - sync.enabled
  - sync.serverUrl
  - sync.encryptionKeyHash
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
Enables real-time, conflict-free synchronization of documents, extracts, flashcards, reading positions, and review histories across all your devices.

## User-Facing Behavior
- Visual sync status indicator in the app header (Green = Synced, Amber = Syncing, Gray = Offline).
- Seamless background syncing: create a card on your desktop and see it on your phone seconds later.
- Offline-first: study on an airplane; all offline changes merge cleanly when you reconnect.

## Exact Behavioral Rules
1. Uses Yjs Conflict-Free Replicated Data Types (CRDTs) to guarantee zero data loss during concurrent offline edits.
2. All sync payloads are encrypted on your device with AES-GCM-256 before transmission; the relay server sees only opaque ciphertext.
3. Delta changes are compressed and synchronized incrementally over secure WebSockets.

## Rationale
Ensures total data privacy and sovereignty while providing modern multi-device convenience.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `sync.enabled` | `false` | Enable cross-device synchronization |
| `sync.serverUrl` | `""` | Optional remote sync endpoint URL |

## Platform Behavior
- **All Platforms**: End-to-end encrypted replication over secure HTTPS.
