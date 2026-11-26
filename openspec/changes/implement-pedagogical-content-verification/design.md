# Design: Implement Pedagogical Content Verification

## Architecture

- **Deterministic Verifier (`src/lib/study-plans/studyMode/pedagogicalVerifier.ts` & Rust `src-tauri/src/study_mode/verifier.rs`)**:
  - Verifies source scope authorization, `content_hash`/revision match, normalized quote containment, anchor bounds, assessment answer-key completeness (e.g., `correctIndex` in bounds, distinct options, non-empty rubric criteria), and SVG/JSON-only rendering safety (rejects `<script`, `javascript:`, `on*=`).
- **Pedagogical Rubric Contract (`src/types/studyMode.ts`)**:
  - `PedagogicalCriterionId` (11 LearnLM Appendix B criteria), `PedagogicalCriterionScore` (`pass | partial | fail | not_assessable`, rationale, evidence), `PedagogicalEvaluationReport` (hard-gate pass/fail, aggregate summary without collapsing hard-gate failures).
- **Bounded Repair**: At most 1 repair attempt via `runTask` when deterministic or semantic verification fails; never infinite-loop; preserve prior valid `study_mode_artifacts` on failure.
- **Fixtures (`src/test/study-mode/pedagogicalFixtures.ts`)**: Deterministic fixture suite in Vitest + Rust unit tests.
