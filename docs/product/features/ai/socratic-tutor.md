---
id: ai.socratic_tutor
title: Socratic Tutoring Sessions
domain: ai
status: implemented
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Multi-turn pedagogical tutoring guiding the user to self-derive difficult concepts with progressive hints and escape hatches.
how_to: Select a difficult paragraph in any reader, click "Ask AI" → "Socratic Tutor". The tutor asks guided questions to test your mental model.
why: Being given a passive explanation leads to the illusion of competence; Socratic dialogue forces active cognitive retrieval and reveals hidden misconceptions.
aliases:
  - socratic tutor
  - ai tutor
  - guided learning
  - concept dialogue
settings:
  - ai.tutor.pedagogicalStyle
actions:
  - id: action.search.command_center
    label: Open Socratic Session
    shortcut: Cmd+K
related:
  - ai.task_router
  - ai.active_recall
  - reader.selection.actions
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
