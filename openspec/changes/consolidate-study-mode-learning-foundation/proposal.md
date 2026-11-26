# Proposal: Consolidate Study Mode Learning Foundation

## Problem Statement

Plethora currently has two overlapping reading-trail systems: `study_reading_trails` (migration 153, JSON manifest/session per Study Plan version) and objective-grounded Study Trails (`learning_segments`, `learning_segment_objectives`, `study_trail_items`, `formative_check_results`, migration 154). Meanwhile, `study_source_repository.rs` has `#occ:N` chunk-disambiguation mismatches, `generate_study_trail_segments_core` ignores `selected.extractIds`, and there is no shared persistence contract for standalone (non-Study-Plan) learning sessions, generated learning artifacts, and source-grounded provenance.

## Goals

1. **Reconcile Guided Reading & Study Trails**: Treat `learning_segments` and `study_trail_items` as the canonical foundation, migrate/bridge authored `study_reading_trails` assignments, fix extract-scope filtering (`selected.extractIds`), fix `PreviewStudyTrailPanel` reorder collisions and rejected-item eligibility, and restore `StudyPlanEditor` default `outlineMode` compatibility.
2. **Fix Source Resolution Defects**: Fix `#occ:N` duplicate chunk verification in `study_source_repository.rs`, HTML entity normalization parity, and `video_id` transcript discovery in `indexer.rs`.
3. **Canonical Study Mode Persistence (Migration 162)**: Add `study_mode_sessions` and `study_mode_artifacts` supporting both standalone document/extract/transcript scopes and Study Plan topic/segment scopes, with stable IDs, source revision tracking, knowledge authority, provenance, staleness detection, and user edit/lock flags.
4. **Optionality Boundary**: Ensure opening or importing documents performs zero automatic Study Mode generation or background AI work.

## Dependencies

- Existing `adaptive-learning-paths`, `ai-task-architecture`, `study_source_repository.rs`, and `learning_segments` (migration 154).

## Non-Goals / Out of Scope

- Replacing `study_plan_prerequisites` or `exam_attempts`/`learning_evidence`.
- Building multimodal views or personalized explanations in this change (covered by Changes 3–6).
