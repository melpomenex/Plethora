# Proposal: Implement Pedagogical Content Verification

## Problem Statement

Generated educational artifacts (explanations, quizzes, rubrics, mind maps, timelines, audio scripts, slides) currently lack a unified deterministic verification + LearnLM Appendix B pedagogical rubric gate. High-engagement outputs could contain fabricated citations, missing qualifications, unanswerable questions, or unsafe HTML/JS payloads.

## Goals

1. **Deterministic Verification Gate**: Validate schema correctness, authorized source IDs, source revisions, quote containment, anchor resolution, concept/objective IDs, assessment answer structures, knowledge authority rules, and safe rendering (no raw HTML/JS execution).
2. **LearnLM Appendix B Pedagogical Rubric**: Implement a reusable 11-criterion evaluation contract (`accuracy`, `source_fidelity`, `coverage`, `emphasis`, `engagement`, `cognitive_load`, `active_learning`, `metacognition`, `motivation_curiosity`, `adaptability`, `clarity_of_intentions`) using 3-level scoring (`pass` = 1.0, `partial` = 0.5, `fail` = 0.0, plus `not_assessable`).
3. **Hard Quality Gates & Bounded Repair**: Enforce `source_fidelity` and `assessment_validity` as hard gates; attempt at most 1 bounded repair before rejecting irreparable output and preserving previously valid artifacts.
4. **Human-Reviewed Evaluation Fixtures**: Build deterministic CI fixtures covering fabricated citations, valid citations with unsupported claims, missing qualifications, misleading analogies, ambiguous questions, incorrect answer keys, prompt injection, and technical notation.

## Dependencies

- `consolidate-study-mode-learning-foundation`, `ai-task-architecture`.

## Non-Goals / Out of Scope

- Running live commercial LLM evaluations automatically in CI (live-provider evals must be explicitly opt-in).
