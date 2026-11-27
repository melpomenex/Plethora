## Context

Wave 1 established the 4-tab (`Learn`, `Practice`, `Explore`, `Progress`), 3-pane workspace with resumable sessions, precision scope keys, real `ExactSearchHitLocation` anchors, and independent cancellable tasks. Wave 2 turns `Learn`, `Practice`, and `Progress` into an adaptive learning loop backed by Plethora's shared learning-evidence engine.

## Goals / Non-Goals

**Goals:**
- Implement a pure, testable 6-stage Guided Loop state machine (`guidedLoop.ts`) interchangeable with Freeform mode.
- Build a typed, extensible multi-format Practice Question Engine (`practiceEngine.ts`) with semantic deduplication, evidence-driven difficulty (`1..5`), progressive hints, misconception feedback, and optional inline knowledge checks.
- Wire `ProgressPanel.tsx` to Plethora's `learning-evidence` API (`getConceptMasterySummary`, `getStudyPlanEvidence`, `listLearningGaps`) + session formative results, strictly separating Exposure, Understanding, and Retention with explicit uncertainty states.

**Non-Goals:**
- Contextual AI Tutor prompt injection & interactive Concept Map graph (Wave 3).
- Playable TTS Audio Lessons & Narrated Slides (Wave 4).
- Automatic FSRS card creation or mutation without user action.

## Decisions

### 1. Guided Loop State Machine (`src/lib/study-plans/studyMode/guidedLoop.ts`)
- Stages: `introduce` → `anchor` → `understand` → `recall` → `adapt` → `reinforce` → `recap`.
- Pure transition reducer (`guidedLoopReducer`) so every transition is deterministic and unit-tested.
- Entering Guided Mode derives objectives from `deriveStudyPathSteps(passageText, documentTitle)` (or active Study Plan topic), so it works standalone on any document with zero upfront setup.
- Switching back to Freeform preserves all generated artifacts and practice evidence.

### 2. Extensible Practice Question Engine (`src/lib/study-plans/studyMode/practiceEngine.ts`)
- `PracticeQuestionKind`: `"multiple_choice" | "free_recall" | "fill_blank" | "ordering" | "scenario_error"`.
- Extensible registry `QUESTION_TYPE_REGISTRY` mapping each kind to metadata (`label`, `shortLabel`, `promptGuidance`, `evaluateLocal`).
- **Semantic Deduplication**:
  - `computeSemanticQuestionFingerprint({ scopeKey, conceptIds, questionKind, prompt })` normalizes lowercase alphanumeric tokens, strips stop words, sorts significant stems, and hashes with FNV-1a (no `Date.now()`!).
  - `isSemanticallyDuplicateQuestion(candidatePrompt, priorPrompts, threshold = 0.72)` checks Jaccard similarity of normalized content tokens so paraphrased repeats are caught before showing to the learner.
- **Evidence-Driven Difficulty**:
  - `selectAdaptiveDifficulty({ masterySummary, recentOutcomes, preferenceDifficulty })` returns integer `1..5`:
    - Starts at `2` for `insufficient-evidence` / `foundational`, `3` for `developing`, `4` for `demonstrated-consistently`, `1` for `needs-attention`.
    - Adjusts `-1` on recent `needs_review` / misconception, `+1` on 2 consecutive `understood` without hints, clamped to `1..5`.
- **Grading**:
  - For `multiple_choice` and `free_recall` (`short_answer`), continues submitting to `submitStudyFormativeAnswer` when in Tauri (authoritative backend grading + `learning_evidence` persistence), and provides deterministic local grading for `fill_blank`, `ordering`, `scenario_error`, and non-Tauri/offline fallback so every format works end-to-end.

### 3. Unified Evidence Progress (`src/lib/study-plans/studyMode/evidenceProgress.ts`)
- Pure aggregator `computeStudyProgressSnapshot({ exposureCount, conceptSummaries, gaps, sessionSubmissions, fsrsReviewedCount, sessionDurationMin })`:
  - Never synthesizes a fake mastery percentage from reading or LLM guesses.
  - Explicitly classifies each concept as `not-assessed`, `insufficient-evidence`, `needs-attention`, `developing`, or `demonstrated-consistently`.
  - Computes a concrete **Recommended Next Session** (`action`, `title`, `reason`, `estimatedMinutes`, `targetTab`, `conceptId`) prioritizing active misconceptions/gaps, then unassessed studied concepts, then spaced review.

## Risks / Trade-offs

- **Backend `submit_study_formative_answer` question kinds**: The Rust backend deterministically grades `multiple_choice` and rubric-based `short_answer`; for `fill_blank`, `ordering`, and `scenario_error`, we pass deterministic rubric evaluation scores or serialize answers cleanly so backend evidence recording still works without requiring a breaking Rust schema migration.
