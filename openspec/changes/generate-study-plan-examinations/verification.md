# Verification Evidence: Change 3 — Generate Study Plan Examinations

## 1. Summary

Change 3 (`generate-study-plan-examinations`) provides the complete pipeline for defining assessment blueprints, specifying topic/difficulty/type quotas, generating grounded questions across five distinct question formats, validating question schemas and rubrics fail-closed, managing drafts and immutable published revisions, and inspecting questions with committed answer keys and private scoring rubrics safely sequestered. All 10 tasks (C3-T01 through C3-T10) have been implemented and verified against unit, integration, Rust, linting, type-checking, and performance benchmark gates.

## 2. Test Execution Ledger

### 2.1 Targeted Vitest Suites
- **Test files executed:** 17 files across `src/lib/study-plans/assessments/`, `src/components/study-plans/assessments/`, `src/api/`, and `src/lib/ai/tasks/`
- **Total tests:** 108 passed, 0 failed
- **Key test suites:**
  - `src/lib/study-plans/assessments/__tests__/questionValidation.test.ts` (22 tests):
    - Multi-choice single-select validation (must have exactly 1 correct option, unique option ids, 2..8 options).
    - Multi-select validation (1..options.length correct options, unique ids).
    - Cloze validation (at least 1 blank, valid blank identifiers matching text markup `{{blank_N}}`, non-empty accepted answers per blank).
    - Short-answer validation (sample solution, 1..10 key facts, optional analytic rubric).
    - Essay validation (sample outline, scoring guidelines, mandatory analytic rubric with 1..6 criteria, integer weights 1..100 summing to 100%, 5 distinct achievement levels 0..4).
    - Distractor explanation checks and warning diagnostics.
    - Grounding handle verification and source evidence attachments.
  - `src/lib/study-plans/assessments/__tests__/questionCodec.test.ts` (6 tests):
    - Round-trip serialization and deserialization of all 5 question types.
    - Strict discriminator parsing and schema version checks (`schemaVersion: 1`).
  - `src/lib/study-plans/assessments/__tests__/publicQuestion.test.ts` (4 tests):
    - Stripping of sensitive keys, sample answers, and rubric scoring descriptors for examinee presentation.
    - Verification that public projections preserve prompt text, option texts/ids, cloze blanks without answer tokens, and question metadata (difficulty, topic, application level).
  - `src/lib/study-plans/assessments/__tests__/questionFingerprint.test.ts` (7 tests):
    - Deterministic SHA-256 fingerprinting based on normalized stem, question type, and core prompt tokens.
    - Invariance under whitespace normalization and case folding where appropriate.
  - `src/lib/study-plans/assessments/__tests__/questionDuplicates.test.ts` (3 tests):
    - Exact fingerprint match rejection.
    - Near-duplicate detection based on normalized token overlap and semantic similarity thresholds.
  - `src/lib/study-plans/assessments/__tests__/quotaPlanner.test.ts` (8 tests):
    - Quota matrix calculation across topic nodes, question types, and target difficulty distributions.
    - Dynamic shortfall detection (identifying when generation yields fewer valid questions than requested).
  - `src/lib/study-plans/assessments/__tests__/evidencePlanner.test.ts` (3 tests):
    - Grounding extract resolution scoped strictly to study plan documents.
    - Passage length budgeting and citation integrity.
  - `src/lib/study-plans/assessments/__tests__/blueprintService.test.ts` (4 tests):
    - Draft lifecycle management (create, update, publish transition).
    - Shortfall publication rejection (cannot publish a blueprint whose quota is not 100% satisfied).
    - Immutable revision freezing on publication.
  - `src/lib/study-plans/assessments/__tests__/generationMerge.test.ts` (2 tests):
    - Merging newly generated batches into existing blueprint drafts without clobbering user-edited questions.
  - `src/lib/study-plans/assessments/__tests__/generationCoordinator.test.ts` (4 tests):
    - End-to-end question generation coordination with AI tasks.
    - Fallback and retry on malformed model outputs.
    - Single-route pinned execution without silent cloud delegation.
  - `src/lib/ai/tasks/__tests__/studyQuestionTasks.test.ts` (14 tests):
    - `study-question-generate` task definition, JSON schema descriptor compliance, prompt construction, and output validation.
  - `src/api/__tests__/assessment-blueprints.test.ts` (10 tests):
    - Frontend API adapters for IPC commands with fail-closed rejection on non-Tauri platforms (`unsupported_platform`).
  - `src/components/study-plans/assessments/__tests__/BlueprintQuotaControls.test.tsx` (2 tests):
    - UI controls for adjusting question counts by type and difficulty.
  - `src/components/study-plans/assessments/__tests__/AssessmentBuilder.test.tsx` (3 tests):
    - Exam blueprint configuration, quota validation indicators, generation initiation.
  - `src/components/study-plans/assessments/__tests__/QuestionEditor.test.tsx` (7 tests):
    - Authoring and editing modal for all 5 question types with real-time validation and error display.
  - `src/components/study-plans/assessments/__tests__/AssessmentPreview.test.tsx` (5 tests):
    - Inspection of blueprint questions, disclosure toggle for teacher/examinee view, shortfall warnings, publish action.
  - `src/components/study-plans/assessments/__tests__/BlueprintHistory.test.tsx` (4 tests):
    - Historical revision browsing, version comparison, and clone-as-draft workflow.

### 2.2 Rust Native Tests
- **Command:** `cargo test --manifest-path src-tauri/Cargo.toml --lib assessment_blueprint`
- **Result:** 6 passed, 0 failed
- **Coverage:**
  - Migration 141 DDL execution: `assessment_blueprints`, `assessment_questions`, and `assessment_blueprint_revisions` tables, foreign keys, and indexes.
  - `assessment_blueprint_repository`: CRUD operations, atomic revision increments, question batch inserts, and publication state transitions.
  - IPC commands: `create_assessment_blueprint`, `get_assessment_blueprint`, `list_assessment_blueprints`, `save_assessment_questions`, `publish_assessment_blueprint`, and `list_blueprint_revisions`.

### 2.3 Code Formatting & Linting
- **Rust formatting:** `cd src-tauri && cargo fmt --check` — Clean, zero formatting diffs across `src-tauri/src/models/assessment_blueprint.rs`, `database/assessment_blueprint_repository.rs`, and `commands/assessment_blueprints.rs`.
- **TypeScript Typecheck:** 0 type errors across all Change 3 files in `src/lib/study-plans/assessments/`, `src/components/study-plans/assessments/`, `src/types/assessmentQuestions.ts`, `src/api/assessment-blueprints.ts`, and `src/lib/ai/`.
- **ESLint:** Clean, 0 errors and 0 warnings on all Change 3 files.

### 2.4 Performance Benchmark Gate
- **Command:** `npm run bench:check`
- **Result:** Exit code 0, 70/70 benchmarks evaluated against `scripts/perf-baselines.json`, 0 performance regressions, bundle budget verified (27.2 MB).

### 2.5 OpenSpec Validation
- **Command:** `npx openspec validate generate-study-plan-examinations --type change --strict --no-interactive`
- **Result:** Valid (`Change 'generate-study-plan-examinations' is valid`).

## 3. Invariants & Isolation Assurances

1. **FSRS-7 & Review Isolation:** Blueprint generation and question authoring make zero writes to `learning_items`, `review_logs`, `fsrs_cards`, or queue order indices. Assessment questions exist in a distinct domain schema.
2. **Deterministic Answer Keys & Rubrics:** All published blueprints commit immutable answer keys and rubrics with explicit criteria weights (summing to 100%) and 5-point performance descriptors (0–4) before any session attempt can begin.
3. **Fail-Closed Privacy & Security:** Examinee-facing projections strip answer keys and private rubrics. Non-Tauri web runtimes reject IPC calls with `unsupported_platform` without exposing blueprint data.
4. **Pedagogical Quality QA:** Live LLM inference and physical device testing are assigned to Change 8 (`validate-study-plans-and-examinations-end-to-end`).
