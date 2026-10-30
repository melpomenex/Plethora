## Why

[Issue #6](https://github.com/melpomenex/Plethora/issues/6) exposes inconsistent ranking mathematics and learning workflows that fail across review surfaces despite earlier completed fixes. Correcting shared contracts for ranking, card presentation, mutation ownership, and AI source identity will protect user data and make successful interactions correspond to persisted results.

## What Changes

- Replace document urgency decay, repeated priority weighting, and the 14-day overdue ceiling with a bounded, monotone, explainable policy. Preserve document/card schedulers and due dates; describe coefficients as product heuristics.
- Preserve the existing higher-means-more-important global priority order, derive manual importance once from its live rank, and make keyboard, pointer, and touch commits share persistence and error handling. Correct contradictory help text during implementation.
- Share cloze and image-occlusion presentation between Review, Scroll Mode, and Optimal Sessions, including validated legacy content, reveal behavior, previews, and missing-asset states.
- Use complete canonical card records and shared editing, undoable deletion, and session reconciliation. Prevent stale refreshes, partial edits, and competing mutations from restoring removed cards or requiring a rating after deletion.
- Give playlist settings drafts and explicit commits; validate both boundaries and make saved global defaults seed new subscriptions.
- Distinguish video-extract viewing from review, expose independent ratings, and eliminate duplicate rating submissions with transactional retry protection.
- Correct assistant card source linkage and result accounting using existing card creation and learning-agent acceptance infrastructure; retain draft/approval semantics and selected providers.
- Resolve selected section bodies through the existing canonical resolver for all card-generation paths, and preserve conversation and reader scroll positions.
- Add workflow-level persistence, race, visual, mathematical, offline, and native-platform verification, with complete issue-to-test traceability.

## Capabilities

### New Capabilities

- `memory-urgency-ranking`: Pure normalized temporal/manual ranking with bounded overdue growth, type-appropriate scheduling signals, and deterministic comparisons.
- `priority-mutation-consistency`: Canonical rank semantics, compatible stored values, and reliable commits across input methods.
- `review-session-mutations`: Identity-based edit/delete/rating coordination, refresh reconciliation, undo, and session completion.
- `playlist-settings-persistence`: Draft validation, explicit commit, defaults versus subscription values, and queue interspersion.
- `video-extract-review-lifecycle`: Seen versus reviewed state, independent scheduling, and exactly-once committed ratings.
- `assistant-scroll-restoration`: Intentional conversation anchoring and preservation of the reader's position.

### Modified Capabilities

- `queue-flashcard-review-cards`: Cross-mode cloze parity, complete card hydration, safe previews, and reliable card actions.
- `review-card-editing`: Shared editor access, lossless raw cloze editing, atomic content/version/tag persistence, and in-place reconciliation.
- `occlusion-review-rendering`: Shared geometry, assets, masking, and error states across all review surfaces.
- `assistant-tool-reliability`: Validated canonical source IDs, persisted success accounting, partial-result recovery, and safe retries.
- `document-section-context`: Canonical multi-section and selected-passage grounding in Chat, Learning Agent, Document Q&A, and Studio with provider parity.
- `flashcard-studio-section-mentions`: Explicit section scope excludes outside-section neighbor content and follows the shared scoped budget.
- `priority-vector-improvements`: Diagnostics and legacy preset scoring consume canonical temporal/manual evidence without compounding priority.

## Impact

Changes are expected in Rust queue algorithms/models/commands/repository and sync paths; frontend queue/review/document views, editor and priority controls; playlist/video APIs and UI; and assistant source-resolution, tool, and conversation layers. Additive persistence is proposed for video viewing and retry-safe review events; no review history, FSRS parameter, priority-order, or cloze-content rewrite is authorized. Existing unarchived changes overlap these subsystems and must be reconciled before implementation.

This change is **proposal-only**. See `investigation.md` for evidence and limitations, `design.md` for decisions and calculations, `traceability.md` for every issue concern, and `verification.md` for tests, platform limits, and handoff criteria. No application fixes, production tests, commits, or pushes are included.
