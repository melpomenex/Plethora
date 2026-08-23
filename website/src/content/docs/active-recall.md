---
title: "Active Recall In-Reading Prompts"
description: "Optional reading interruptions generating comprehension checks and free-response questions with automated semantic grading."
category: "ai-and-models"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["active recall","reading interruptions","comprehension check","in-reading quiz"]
aliases: ["active recall","reading interruptions","comprehension check","in-reading quiz"]
relatedDocs: ["ai.socratic_tutor","ai.learn_this","reader.pdf.scroll_mode"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/ai/active-recall.md"
---
# Active Recall In-Reading Prompts

## Purpose
Transforms passive document reading into an active retrieval practice session by injecting automated comprehension check questions.

## User-Facing Behavior
- While scrolling through a book or paper, an inline comprehension prompt appears after every N pages or sections.
- Shows a concise free-response question about the material you just finished reading.
- Type your answer or click "Reveal Model Answer".
- The AI evaluates your free-response answer and provides constructive feedback.

## Exact Behavioral Rules
1. Uses `recallQuestion.ts` to formulate conceptual comprehension questions from preceding text blocks.
2. Semantic grading uses `answerAssessment.ts` to compare your response against key concepts.
3. Automatically offers to convert failed comprehension checks into review flashcards.

## Rationale
Testing comprehension immediately after reading prevents the false feeling of fluency and identifies gaps in understanding while the text is still fresh.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `reader.activeRecall.enabled` | `false` | Enable intermittent active recall questions during reading |
| `reader.activeRecall.frequencyPages` | `4` | Number of pages between active recall prompts |

## Platform Behavior
- **All Platforms**: Non-blocking popover; user can easily dismiss or snooze with Escape.