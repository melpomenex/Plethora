## Why

Plethora's Study Plans system supports source-grounded curricula, prerequisites, assessments, and adaptive remediation, while Language Learning maintains separate profile-scoped vocabulary, practice attempts, and learner evidence. Integrating Language Learning with Study Plans lets learners structure multi-week language goals without duplicating curriculum or examination infrastructure.

## What Changes

- Add optional `language_profile_id`, `target_proficiency`, and `language_focus_json` fields to `study_plans` (migration `160_study_plan_language_profile`).
- Allow `StudyPlanCreateForm` and `StudyPlanEditor` to optionally link a Language Profile and configure language-learning objectives (e.g., conversational fluency, reading novels, listening comprehension, target exam prep) incorporating library docs, generated graded content, vocabulary/grammar targets, reading/listening/writing/speaking exercises, flashcards, and study gaps.
- Filter non-instructional sections (tables of contents, bibliographies, front/back matter) out of generated language prerequisites and preserve source provenance on derived examinations.
- Preserve standalone immersive language learning completely independent of Study Plans.

## Capabilities

### New Capabilities

- `language-study-plan-integration`: Profile-scoped linkage between Language Learning and Study Plans for curriculum generation, activity adaptation, and comprehension assessment without making immersive study dependent on Study Plans.

## Impact

- `src-tauri/src/database/migrations.rs` (`160_study_plan_language_profile`), `src-tauri/src/models/study_plan.rs`, `src-tauri/src/database/study_plan_repository.rs`, `src-tauri/src/commands/study_plans.rs`.
- `src/api/study-plans.ts`, `src/components/study-plans/StudyPlanCreateForm.tsx`, `src/components/study-plans/StudyPlanEditor.tsx`.
