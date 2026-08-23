---
title: "Socratic Tutoring Sessions"
description: "Multi-turn pedagogical tutoring guiding the user to self-derive difficult concepts with progressive hints and escape hatches."
category: "ai-and-models"
order: 100
published: true
featureStatus: "shipping"
platforms: ["desktop-macos","desktop-windows","desktop-linux","mobile-android","mobile-ios"]
keywords: ["socratic tutor","ai tutor","guided learning","concept dialogue"]
aliases: ["socratic tutor","ai tutor","guided learning","concept dialogue"]
relatedDocs: ["ai.task_router","ai.active_recall","reader.selection.actions"]
owner: "E"
claimIds: []
sourcePath: "docs/product/features/ai/socratic-tutor.md"
---
# Socratic Tutoring Sessions

## Purpose
Provides an interactive pedagogical dialogue that helps learners understand complex concepts through guided inquiry rather than passive answers.

## User-Facing Behavior
- Opens a lightweight side-panel chat attached to the active document.
- The tutor asks targeted probing questions: *"What would happen to the memory stability if interval was doubled?"*
- Offers three hint levels (`[Small Hint]`, `[Bigger Hint]`, `[Just Explain It]`).
- Concludes the session by generating a customized flashcard locking in the insight.

## Exact Behavioral Rules
1. Uses `socraticTutor.ts` task definition with strict state tracking (concept mastery score, hint level index).
2. The tutor will never reveal the final answer until the user attempts an answer or explicitly clicks "Just Explain It".
3. Grounded in the source document passage to prevent drifting into irrelevant topics.

## Rationale
Active elaboration and generation effects are proven by cognitive science to create vastly stronger neural memory traces than passive reading.

## Settings & Defaults
| Key | Default | Description |
| :--- | :--- | :--- |
| `ai.tutor.pedagogicalStyle` | `"encouraging-rigorous"` | Tone and rigor of the tutor's guiding questions |

## Platform Behavior
- **All Platforms**: Smooth, responsive multi-turn dialogue with streaming markdown support.