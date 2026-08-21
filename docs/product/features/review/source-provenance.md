---
id: review.source_provenance
title: Review Card Source Provenance
domain: review
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Collapsible "From: Document Name (Page X)" footer linking directly back to the origin text, extract context, and media timestamp.
how_to: During card review, click the "Source" footer or press Shift+S to reveal the original paragraph and surrounding context.
why: Atomized flashcards risk losing conceptual grounding; immediate 1-click access to the original book or lecture restores holistic understanding.
aliases:
  - source citation
  - card provenance
  - context peek
  - origin document
settings:
  - review.provenance.autoExpandOnLapse
actions:
  - id: action.review.start
    label: Start Review Session
    shortcut: Alt+R
related:
  - queue.extract_chain
  - reader.selection.actions
  - review.flashcard_studio
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
