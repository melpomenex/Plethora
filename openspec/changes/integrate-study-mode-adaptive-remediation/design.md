# Design: Integrate Study Mode Adaptive Remediation

## Architecture

- **Mastery Alignment (`learning_evidence_repository.rs`)**: Update `recompute_concepts_tx` misconception resolution to match `evidenceAggregation.ts` (cleared only by a subsequent group with score >= 0.8 and no misconception) and emit `one-independent-session` when `independent_sessions == 1`.
- **Remediation Planner (`src/lib/study-plans/studyMode/remediation.ts`)**: Reuses `planRemediationForGap` (`remediationPlanner.ts`) + `getRemediationTrailItems` to propose concrete, accept/defer/dismiss actions for any detected gap or formative misconception.
- **Tutor & FSRS Integration**: Wire `onOpenTutor` in `DocumentViewer.tsx` for `GuidedReadingPanel` and `StudyModeWorkspace` (`TutorSheet` with `studyContext`); add explicit "Promote to Flashcard" action using existing `create_learning_item` / card creation commands without touching FSRS intervals for unpromoted formative checks.
