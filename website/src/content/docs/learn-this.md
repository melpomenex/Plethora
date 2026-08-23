---
title: "\"Learn This\" Card Generation"
description: "AI-powered multi-type flashcard generation from selected reading text, enforcing the 20 Rules of Formulating Knowledge and source provenance."
category: "ai-and-models"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["learn this","auto flashcard","ai card generator","generate cards"]
aliases: ["learn this","auto flashcard","ai card generator","generate cards"]
relatedDocs: ["ai.task_router","reader.selection.actions","review.flashcard_studio","review.source_provenance"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/ai/learn-this.md"
---
# "Learn This" Card Generation

## Purpose
Transforms complex reading passages into atomic, well-formulated spaced repetition flashcards adhering to proven cognitive learning principles.

## User-Facing Behavior
- Clicking "Learn This" generates a modal preview with 1 to 4 proposed cards:
  - **Atomic Q/A**: Direct, unambiguous question-and-answer pairs.
  - **Cloze Deletion**: High-yield factual sentence with `{{c1::key term}}` hidden.
  - **Conceptual Contrast**: Compares and contrasts two easily confused mechanisms.
- The user can accept, edit, or reject individual cards before saving them to their study deck.

## Exact Behavioral Rules
1. Uses `learnThisTask.ts` with strict knowledge formulation heuristics (rules against 1-to-many lists, ambiguous questions, and verbose wording).
2. Verifies that answers are verbatim-grounded in the selected source text.
3. Automatically attaches originating document title, page number, and highlight offset to the generated cards.

## Rationale
Dr. Piotr Wozniak's 20 Rules of Formulating Knowledge emphasize the minimum information principle. "Learn This" enforces these rules automatically.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `ai.learnThis.maxCardsPerGeneration` | `3` | Maximum number of flashcards generated per selection |

## Platform Behavior
- **All Platforms**: Bounded prompts with sub-second execution on fast providers.