## 1. Shared rating-schema and grade semantics

- [x] 1.1 Create `src/lib/rating-grades.ts` consolidating the grade↔rating equivalence (0/1/2→1, 3→2, 4→3, 5→4), grade labels/labelKeys, colors, and `SUGGESTED_GRADE_BY_RATING`; re-export `SixPointGrade`, `RATING_LABELS`, `RATING_COLORS` from it.
- [x] 1.2 Refactor `RatingButtons.tsx` (`GRADE_BUTTONS`), `useRatingJoystick.ts` (`JOYSTICK_GRADES`), and the `ReviewSession`/`ZenReviewMode` keyboard mappings to import from the shared module; no behavior change.
- [x] 1.3 Add `getRatingSchema(algorithm): RatingSchema` (`{ type: "legacy-third-party"|"four-grade", grades }`) and a `useRatingSchema()` hook over the settings store; Plethora Adaptive and Plethora Precision → six-grade Plethora, all others → four-grade.

## 2. Shared rating control

- [x] 2.1 Create `SixGradeRatingControl` (desktop → `RatingButtons gradeScale`; touch → `useRatingJoystick` + `RatingJoystick`), taking `onSelect(grade, rating)` and optional `suggestedRating`; use `useFormFactor`/`isTouch` exactly as `ReviewSession` does.
- [x] 2.2 Refactor `ReviewSession.tsx` and `ZenReviewMode.tsx` to replace the inline `useNativeGrades` (`adaptive||precision`) check and joystick/button orchestration with the schema hook + shared control; Review UX must be pixel/behavior-identical.

## 3. Queue adoption

- [x] 3.1 Extend `QueueScrollPage.handleRating` to accept an optional `grade` and pass it through `submitReview`/`rateDocumentEngaging`/`submitExtractReview` submissions so the backend native-grade path is used under Plethora schemas (legacy 1–4 `rating` still populated).
- [x] 3.2 Render the schema-driven control in `ScrollOverlayControls` (desktop six-button branch; keep four-orb UI for four-grade schemas), wiring `onRate(grade, rating)`.
- [x] 3.3 Enable the joystick in Queue for touch + Plethora schema, reusing the shared control (no Queue-specific joystick copy); ensure it coexists with queue scrolling/transitions and the mobile bottom bar falls back appropriately.
- [x] 3.4 Extend `resolveScrollRatingKey` to accept 0–5 (grade submission) under Plethora schemas; keep 1–4 for four-grade.
- [x] 3.5 Verify Queue workflows after grading: item advancement, persistence, scheduling-state update, dismiss/complete, optimistic updates, undo, statistics, offline behavior.

## 4. Automated tests

- [x] 4.1 Unit-test `getRatingSchema` for all algorithms (adaptive/precision → legacy-third-party-6; fsrs/classic/… → four-grade).
- [x] 4.2 Unit-test `useRatingJoystick` gesture math: each H-zone/drag direction → expected grade+rating, dead-zone no-commit, release-in-zone commit (first such tests; write before/with the 1.x refactor).
- [x] 4.3 Component/matrix tests: view (Queue, Review) × platform (desktop, touch) × algorithm (Plethora Adaptive, Plethora Precision, fsrs) asserting which control renders.
- [x] 4.4 Per-grade pipeline tests: selecting each of grades 0–5 in Queue and in Review produces the expected `submitReview` payload (`grade` exact, `rating` equivalent); assert Queue≡Review equivalence and no 4-grade normalization.
- [x] 4.5 Keyboard tests: Queue 0–5 under Plethora, 1–4 under four-grade; Review keys unchanged.

## 5. Manual QA and validation

- [ ] 5.1 Android: Plethora Adaptive and Plethora Precision in Queue — joystick present, all six positions submit expected grades; compare side-by-side with Review; test drag/tap/release, accidental movement, portrait/landscape, small screens.
- [ ] 5.2 Desktop: Plethora Adaptive and Plethora Precision in Queue and Review — six buttons, consistent labels/shortcuts/tooltips; keyboard 0–5 works.
- [ ] 5.3 Four-grade scheduler (e.g. FSRS): Queue and Review show four-rating UI, submissions unchanged.
- [x] 5.4 Run `npm run bench:check` and update `scripts/perf-baselines.json` only if rating-path benchmarks intentionally changed.
- [x] 5.5 Record device-QA results in the change folder per repo convention.
