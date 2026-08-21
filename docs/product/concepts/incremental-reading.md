---
id: concepts.incremental_reading
title: Incremental Reading Philosophy & Workflow
domain: concepts
status: implemented
platforms:
  - all
summary: Comprehensive guide to the SuperMemo incremental reading methodology, extract formulation, and knowledge distillation in Plethora.
how_to: Import multiple long-form articles or books into your reading queue. Read in spaced increments, extracting key insights as you go.
why: Reading linearly from cover to cover causes reader burnout and fast forgetting; incremental reading processes hundreds of texts simultaneously in bite-sized increments.
aliases:
  - incremental reading
  - supermemo method
  - knowledge distillation
  - reading workflow
settings:
  - queue.composition
actions:
  - id: action.queue.open
    label: Open Reading Queue
    shortcut: Alt+Q
related:
  - queue.scroll_session
  - queue.extract_chain
  - queue.priority_score
---

# Incremental Reading Philosophy & Workflow

## Purpose
Explains the theoretical foundations, cognitive benefits, and practical workflow of Incremental Reading (IR) as pioneered by Dr. Piotr Wozniak.

## User-Facing Behavior
- Learners do not read an entire 800-page book in one sitting.
- Instead, articles and books are processed in small chunks across days and months.
- When an inspiring passage appears, select it and create an extract (`Cmd+E`).
- Convert mature extracts into atomic Q/A and Cloze flashcards (`Cmd+L` or Flashcard Studio).

## Exact Behavioral Rules
1. Ingestion: Import articles, research papers, and books into your Plethora library.
2. Prioritization: Assign priority scores (0-100) to ensure high-value materials appear first.
3. Extraction: Extract the core 10-20% of text containing key insights and dismiss the remaining fluff.
4. Cloze / Card Formulation: Turn the distilled extracts into active recall flashcards.
5. Review: Study cards in the Spaced Repetition engine to lock memories permanently.

## Rationale
Prevents cognitive overload, allows complex ideas to incubate over time, and eliminates the pressure to finish low-value books linearly.

## Platform Behavior
- Supported seamlessly across desktop and mobile devices.
