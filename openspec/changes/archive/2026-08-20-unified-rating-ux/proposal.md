## Why

Incrementum supports six-grade Plethora schedulers (Plethora Adaptive, Plethora Precision), but the Queue always shows a four-rating interface (Again/Hard/Good/Easy) regardless of algorithm, while Review already has the correct UX: six explicit grade buttons on desktop and a gesture joystick on mobile. Queue therefore silently collapses the six-grade 0–5 grade space into four values via `rating_to_grade` before the scheduler ever runs, distorting scheduling semantics; the user is also shown an interface that misrepresents what the algorithm expects.

## What Changes

- Introduce a **scheduler rating-schema capability**: the active scheduler (algorithm) declares its native rating scale (four-grade vs. six-grade Plethora) through a shared frontend abstraction instead of scattered `algorithm === "adaptive" || algorithm === "precision"` checks in view code.
- **Queue (desktop)**: when the active schema is Plethora six-grade, show the same six explicit rating buttons (`RatingButtons` with `gradeScale`) already used by Review desktop; four-grade algorithms keep the existing four-button UI.
- **Queue (mobile/touch)**: when the active schema is Plethora six-grade, use the existing Review mobile joystick (`useRatingJoystick` + `RatingJoystick`), refactored into a shared control rather than a Queue-specific copy. Four-grade algorithms keep the current four-orb / swipe interface.
- **Review**: unchanged user-facing behavior; internal refactor only to consume the shared rating-schema abstraction and shared grade↔rating mapping (currently duplicated in `RatingButtons.GRADE_BUTTONS`, `useRatingJoystick.JOYSTICK_GRADES`, the `ReviewSession` keyboard handler, and twice in the backend).
- **Scheduler correctness**: Queue submissions under Plethora Adaptive/Plethora Precision pass the exact selected grade (0–5) through `submitReview`/`submit_review`'s existing `grade` channel — no four-grade normalization. Queue and Review must produce identical scheduler inputs for the same grade.
- **Keyboard**: Queue gains grade shortcuts 0–5 under six-grade schemas (mirroring Review), keeping 1–4 for four-grade schemas.
- No changes to the Plethora Adaptive/Plethora Precision algorithms themselves, interval math, DB schema, or sync format (`review_log` already stores `rating`; `grade` flows through the existing native-grade path).

## Capabilities

### New Capabilities
- `scheduler-rating-ux`: Rating schema discovery (scheduler declares its rating scale), platform-appropriate rating controls (desktop buttons / mobile joystick) shared between Queue and Review, grade-preserving submission pipeline, and the platform × view × algorithm test matrix.

### Modified Capabilities
<!-- Existing specs (document-rating, flashcard-review-session, queue-item-type-routing, schedule-workspace) describe routing/session concerns; their requirements do not change — this change adds a new cross-cutting capability without altering those specs' requirement-level behavior. -->

## Impact

- **Frontend**:
  - `src/api/review.ts` — add rating-schema derivation (e.g. `getRatingSchema(algorithm)` / `useRatingSchema`); consolidate `SixPointGrade`, `RATING_LABELS`, `RATING_COLORS`.
  - `src/components/review/RatingButtons.tsx`, `src/hooks/useRatingJoystick.ts`, `src/components/review/RatingJoystick.tsx` — extract shared grade↔rating mapping; keep public behavior identical.
  - `src/components/review/ReviewSession.tsx`, `src/components/review/ZenReviewMode.tsx` — replace inline `adaptive||precision` checks with the schema abstraction.
  - `src/components/queue/ScrollOverlayControls.tsx`, `src/pages/QueueScrollPage.tsx` — render schema-driven rating UI (six buttons on desktop, joystick on touch) and pass grades through `handleRating`.
- **Backend**: no behavioral change; `src-tauri/src/commands/review.rs` `submit_review` already accepts `grade` and bypasses `rating_to_grade` when present.
- **Tests**: new matrix tests (view × platform × algorithm), per-grade mapping tests for Queue and Review equivalence, joystick hook tests (currently none exist).
- **No migration**: no data, settings, or sync format changes.
