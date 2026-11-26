## 1. Schema, Backend & API

- [x] 1.1 Migration `160_study_plan_language_profile` added in `src-tauri/src/database/migrations.rs` (line 6420): `ALTER TABLE study_plans ADD COLUMN language_profile_id TEXT REFERENCES language_profiles(id) ON DELETE SET NULL`, plus nullable `target_proficiency` and `language_focus_json`.
- [x] 1.2 Rust Study Plan model fields (`language_profile_id`, `target_proficiency`, `language_focus_json`), repository `update_study_plan_language_linkage` (`study_plan_repository.rs`), command registration (`commands/study_plans.rs`), and `src/api/study-plans.ts` `updateStudyPlanLanguageLinkage` wrapper. `cargo check --lib` passes. TS wrapper covered by `src/api/__tests__/study-plans-linkage.test.ts` (command args, null coalescing, `StudyApiError` normalization).

## 2. Study Plans UI & Adaptation

- [x] 2.1 `StudyPlanCreateForm.tsx` and `StudyPlanEditor.tsx` include the optional `LanguageProfileSection` (language profile, target proficiency, language focus) and submit it through `updateStudyPlanLanguageLinkage` on save.
- [x] 2.2 Learner evidence → gap recommendation wiring (coverage/practice gaps/flashcards feeding activity recommendations). `src/lib/studyPlans/gapRecommendations.ts` derives deterministic recommendations from lexicon coverage (node term overlap vs. profile vocabulary), practice recency (accepted attempts in 14 days), and language-linked flashcard volume, with severity ranking and i18n keys; `LearnerEvidenceSection` (mounted in `StudyPlanEditor` when a language profile is linked) fetches live evidence (`listLanguageLexicalEntries`, `listLanguagePracticeAttempts`, `getAllLearningItems` filtering `languageProfileId`) and renders ranked next-step recommendations with an "Open Language Learning" action.

## 3. Verification

- [x] 3.1 Language-linkage API wrapper is unit-tested (`src/api/__tests__/study-plans-linkage.test.ts`); migration includes `ON DELETE SET NULL`. TOC/bibliography/index/front-matter filtering is verified in the study-trail pipeline (`ClassificationContext::is_permitted`, `is_excluded_by_default()` default exclusion in `src-tauri/src/study_trail/content_classifier.rs` + `retrieval_pipeline.rs`, with dedicated tests in `src-tauri/src/study_trail/tests.rs`); prerequisite ordering is handled by `plan_study_trail`. Pre-existing Study Plans TS suite baseline failures remain unrelated (verified identical at HEAD `bb35bac6` and `ec58a97c`).
