---
title: "Anki Deck Import (.apkg)"
description: "Ingests Anki `.apkg` packages, converting SQLite notes, templates, Cloze deletions, audio media, and scheduling intervals into Plethora cards."
category: "capture-and-import"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["anki import","apkg deck","anki cards","anki converter"]
aliases: ["anki import","apkg deck","anki cards","anki converter"]
relatedDocs: ["review.flashcard_studio","scheduler.fsrs","scheduler.adaptive"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/imports/anki-apkg.md"
---
# Anki Deck Import (.apkg)

## Purpose
Enables total migration of Anki flashcard decks, card styling templates, audio recordings, images, and card repetition histories into Plethora.

## User-Facing Behavior
- Unpacks compressed `.apkg` zip archive and inspects internal SQLite `collection.anki2` database.
- Displays deck hierarchy, card count, note types, and media asset summary before import confirmation.
- Converts Cloze deletions (`{{c1::answer}}`), MathJax/KaTeX formulas, and image assets seamlessly.

## Exact Behavioral Rules
1. Maps Anki note models (Basic, Cloze, Reverse) to Plethora `CardType` structures.
2. Extracts media files (audio MP3, WebP, PNG) into the local asset storage folder.
3. Converts Anki stability/difficulty/interval values into FSRS-6 / Plethora Adaptive state parameters so due dates remain consistent.

## Rationale
No user should be forced to abandon their hard-earned spaced repetition memory stability when switching to Plethora's incremental reading environment.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `import.anki.preserveScheduling` | `true` | Retain historical ease factors and review intervals |
| `import.anki.importMedia` | `true` | Extract and link audio and image files |

## Platform Behavior
- **All Platforms**: Fast native unpacking with progress indicator.