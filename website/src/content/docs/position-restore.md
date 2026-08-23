---
title: "Reading Position Persistence"
description: "Exact scroll offset, page index, and EPUB CFI persistence across tab switches, restarts, and cross-device sync."
category: "read-and-listen"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["remember position","resume reading","scroll persistence","bookmark position"]
aliases: ["remember position","resume reading","scroll persistence","bookmark position"]
relatedDocs: ["reader.pdf.page_mode","reader.epub.cfi","sync.yjs_cloud"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/reading/position-restore.md"
---
# Reading Position Persistence

## Purpose
Guarantees seamless reading resumption across all document types without requiring manual bookmarks.

## User-Facing Behavior
- Opening a document immediately scrolls to the exact sentence or page last viewed.
- Displays a subtle progress indicator ("Page 42 of 280 (15%)").
- Restores active zoom level, spread mode, and sidebar TOC expansion state.

## Exact Behavioral Rules
1. Debounces position updates to SQLite `position` table to avoid disk I/O thrashing during fast scrolling.
2. Formats:
   - PDF: Page number + internal scroll offset percentage.
   - EPUB: Canonical Fragment Identifier (CFI) string.
   - HTML / Markdown / TXT: Character offset and vertical scroll percentage.
   - Audio / Video: Floating-point playback timestamp in seconds.
3. Flushes in-flight position saves on window unload or tab switch.

## Rationale
Incremental reading involves interleaving dozens of different texts in a single day. Reliable state recovery is non-negotiable for multi-tasking.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `viewer.position.autoSaveIntervalMs` | `500` | Position save debounce interval |

## Platform Behavior
- **Desktop & Mobile**: Shared position schemas synced via encrypted delta logs.
- **Offline**: Fully functional without network connectivity.