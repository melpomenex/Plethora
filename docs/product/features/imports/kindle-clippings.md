---
id: import.kindle
title: Kindle Clippings Ingestion
domain: imports
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
summary: Ingests `My Clippings.txt` files from Amazon Kindle devices, matching book highlights to library documents or creating standalone extracts.
how_to: Connect Kindle via USB or select your `My Clippings.txt` file from Settings → Import → Kindle Clippings.
why: Millions of readers highlight passages on e-ink Kindle devices; importing them directly into Plethora activates them in spaced repetition and incremental reading.
aliases:
  - kindle highlights
  - my clippings
  - amazon kindle
  - kindle sync
settings:
  - import.kindle.autoMatchBooks
actions:
  - id: action.queue.open
    label: View Ingested Extracts
    shortcut: Alt+Q
related:
  - queue.extract_chain
  - library.collection
  - import.local_files
---

# Kindle Clippings Ingestion

## Purpose
Bridges physical Kindle e-readers with Plethora's incremental reading and flashcard ecosystem by parsing exported clipping text logs.

## User-Facing Behavior
- Parses highlights, notes, and bookmarks from standard Amazon Kindle `My Clippings.txt` exports.
- Group highlights by book title and author.
- Offers an interactive reconciliation dialog allowing users to link clippings to existing library EPUBs/PDFs or import as new extracts.

## Exact Behavioral Rules
1. Regex-parses timestamp, location/page coordinates, and highlight text from multilingual Kindle formats (EN, DE, FR, ES, JA, ZH).
2. Deduplicates previously imported clippings to allow incremental re-imports as you read more on your Kindle.
3. Automatically sets priority score for new extracts based on book title category.

## Rationale
Kindle highlights typically languish unread in static text files. Ingesting them into Plethora schedules them into active recall loops.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `import.kindle.autoMatchBooks` | `true` | Attempt fuzzy match between Kindle book titles and Plethora library |

## Platform Behavior
- **Desktop**: Direct USB disk mounting detection for plugged-in Kindle devices.
