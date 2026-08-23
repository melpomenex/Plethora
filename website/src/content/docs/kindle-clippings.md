---
title: "Kindle Clippings Ingestion"
description: "Ingests `My Clippings.txt` files from Amazon Kindle devices, matching book highlights to library documents or creating standalone extracts."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux"]
keywords: ["kindle highlights","my clippings","amazon kindle","kindle sync"]
aliases: ["kindle highlights","my clippings","amazon kindle","kindle sync"]
relatedDocs: ["queue.extract_chain","library.collection","import.local_files"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/kindle-clippings.md"
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