---
title: "Review Card Source Provenance"
description: "Collapsible \"From: Document Name (Page X)\" footer linking directly back to the origin text, extract context, and media timestamp."
category: "remember-and-review"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["source citation","card provenance","context peek","origin document"]
aliases: ["source citation","card provenance","context peek","origin document"]
relatedDocs: ["queue.extract_chain","reader.selection.actions","review.flashcard_studio"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/review/source-provenance.md"
---
# Review Card Source Provenance

## Purpose
Maintains an unbreakable hyperlink between every flashcard and the exact document, extract, or media recording where the knowledge originated.

## User-Facing Behavior
- Shows a subtle footer on the back of the card: `[Source: Deep Learning (Goodfellow) › Page 142]`.
- Clicking the footer opens a slide-over panel displaying the full surrounding paragraph.
- Clicking "Open Document" opens the original book directly to that page in a new tab.

## Exact Behavioral Rules
1. Every card generated via "Learn This", Flashcard Studio, or Selection Bar records its originating `documentId`, `extractId`, and citation snippet.
2. If a card is answered with "Again" (lapsed), the provenance context can optionally auto-expand to assist re-encoding.
3. Provenance survives document file renames and moves.

## Rationale
Prevents cards from degenerating into meaningless trivia. When you forget why a fact matters, the source context instantly refreshes the underlying concept.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `review.provenance.autoExpandOnLapse` | `true` | Automatically show source text when rating Again |

## Platform Behavior
- **All Platforms**: Deep linking opens documents and seeks media timestamps instantly.