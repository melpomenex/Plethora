---
title: "Multi-Format File Import"
description: "Drag-and-drop or file picker ingestion for PDF, EPUB, MD, TXT, MP3, MP4, and APKG files with automatic metadata extraction."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["add file","open document","drag and drop","folder import"]
aliases: ["add file","open document","drag and drop","folder import"]
relatedDocs: ["library.collection","import.url_scraping","reader.pdf.page_mode"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/local-files.md"
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