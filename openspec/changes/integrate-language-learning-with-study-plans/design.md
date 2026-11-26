## Context

Study Plans already own 33 SQLite tables for plans, nodes, sources, blueprints, assessments, and study gaps. Adding an optional foreign key to `language_profiles` lets Study Plans incorporate learner vocabulary, coverage, and practice evidence natively.

## Goals / Non-Goals

**Goals:**
- Link a Study Plan optionally to a `language_profile_id` with `ON DELETE SET NULL` safety.
- Ground language curriculum nodes, prerequisites, and examinations in real library sources, generated graded passages, and measured learner gaps.
- Keep standalone Language Learning (readers, Peek, Queue, Dashboard) 100% functional without Study Plans.

**Non-Goals:**
- Creating a separate curriculum or exam engine for languages.
- Creating meaningless prerequisites from tables of contents or bibliographies.

## Decisions

1. **Optional profile foreign key.** `study_plans.language_profile_id` is nullable with `ON DELETE SET NULL`, so deleting a language profile never destroys user Study Plans.
2. **Non-instructional prerequisite filtering.** Filter TOC/bibliography/index/colophon headings during language plan generation.

## Risks / Trade-offs

- [Profile deleted while plan open] -> Clear profile badge gracefully and retain existing plan nodes/sources.
