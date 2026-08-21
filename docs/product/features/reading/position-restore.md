---
id: reader.position.restore
title: Reading Position Persistence
domain: reading
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Exact scroll offset, page index, and EPUB CFI persistence across tab switches, restarts, and cross-device sync.
how_to: Close any tab or restart Plethora. Upon reopening, the document opens precisely at the line or paragraph you were reading.
why: Losing one's place in a 600-page textbook or long research paper wastes cognitive energy and damages reading continuity.
aliases:
  - remember position
  - resume reading
  - scroll persistence
  - bookmark position
settings:
  - viewer.position.autoSaveIntervalMs
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - reader.pdf.page_mode
  - reader.epub.cfi
  - sync.yjs_cloud
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
