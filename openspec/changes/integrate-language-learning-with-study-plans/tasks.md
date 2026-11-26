## 1. Schema, Backend & API

- [x] 1.1 Migration `160_study_plan_language_profile` added in `src-tauri/src/database/migrations.rs` (line 6420): `ALTER TABLE study_plans ADD COLUMN language_profile_id TEXT REFERENCES language_profiles(id) ON DELETE SET NULL`, plus nullable `target_proficiency` and `language_focus_json`.
- [x] 1.2 Rust Study Plan model fields (`language_profile_id`, `target_proficiency`, `language_focus_json`), repository `update_study_plan_language_linkage` (`study_plan_repository.rs`), command registration (`commands/study_plans.rs`), and `src/api/study-plans.ts` `updateStudyPlanLanguageLinkage` wrapper. `cargo check --lib` passes. TS wrapper covered by `src/api/__tests__/study-plans-linkage.test.ts` (command args, null coalescing, `StudyApiError` normalization).

## 2. Study Plans UI & Adaptation

- [x] 2.1 `StudyPlanCreateForm.tsx` and `StudyPlanEditor.tsx` include the optional `LanguageProfileSection` (language profile, target proficiency, language focus) and submit it through `updateStudyPlanLanguageLinkage` on save.
- [ ] 2.2 Learner evidence → gap recommendation wiring (coverage/practice gaps/flashcards feeding activity recommendations) is not implemented; study plans remain profile-linked but independent of live lexicon/coverage evidence.

## 3. Verification

- [ ] 3.1 Language-linkage API wrapper is unit-tested; migration includes `ON DELETE SET NULL`. Source-provenance, TOC/bibliography prerequisite filtering, and standalone-immersive independence remain covered only by the pre-existing Study Plans suites, which have baseline failures unrelated to this change (verified identical at HEAD `bb35bac6`).
