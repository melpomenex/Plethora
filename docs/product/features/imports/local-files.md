---
id: import.local_files
title: Multi-Format File Import
domain: imports
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Drag-and-drop or file picker ingestion for PDF, EPUB, MD, TXT, MP3, MP4, and APKG files with automatic metadata extraction.
how_to: Drag any document into Plethora or press Cmd+O to open the system file picker. Folders can be imported recursively.
why: Knowledge workers store research in diverse formats across local storage drives; local-first ingestion ensures complete user ownership and zero cloud dependency.
aliases:
  - add file
  - open document
  - drag and drop
  - folder import
settings:
  - library.autoImportDirectory
  - library.extractCoverImages
actions:
  - id: action.search.command_center
    label: Open File Search
    shortcut: Cmd+K
related:
  - library.collection
  - import.url_scraping
  - reader.pdf.page_mode
---

# Multi-Format File Import

## Purpose
Provides unified local file ingestion supporting all major digital reading, media, and spaced repetition document formats.

## User-Facing Behavior
- Drag files or directories directly onto the window or use the file picker button.
- Shows live import progress with item count, extracted metadata, and cover thumbnail preview.
- Automatically creates library entries categorized by format.

## Exact Behavioral Rules
1. Computes SHA-256 content hashes to detect and prevent duplicate document imports.
2. Extracts embedded metadata (PDF author/title/ISBN, EPUB Dublin Core tags, ID3 audio tags).
3. Large files (>100MB) use streaming range requests rather than loading entirely into RAM.

## Rationale
Prevents data lock-in and respects privacy by storing all source files locally in the user's Plethora library directory.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `library.extractCoverImages` | `true` | Generate visual thumbnails for library cards |

## Platform Behavior
- **Desktop**: Native OS file dialogs and recursive folder scanning.
- **Android**: Storage Access Framework (SAF) folder picker integration.
