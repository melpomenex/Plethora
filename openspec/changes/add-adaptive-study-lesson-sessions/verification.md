# Verification notes — Adaptive Study Lesson Sessions

## 1.1 Launch contracts recorded (source-backed vs model-only)

- **Source-backed lessons** pin `plan_version_id + node_id + objective_index`, the plan's
  frozen knowledge authority, and a source revision snapshot (resolved document
  id:revision list). Scope retrieval is restricted to current eligible refs in the
  pinned scope; the scoped tutor surface (`StudyTutorHost` → `buildStudyTutorContext`
  + `studyTutorPrivacy`) enforces the pinned authority and the endpoint preflight
  (AI-excluded/local-only/off-device disclosure/billable consent) before any turn.
- **Model-only lessons** launch with an empty source snapshot and no retrieval, embedding,
  or web adapters; UI labels the lesson unverified and keeps the local composer; the
  native evidence gate already excludes model-only practice results from demonstrated evidence.
- C7 baseline exists: `TutorSession` (bounded Socratic state machine, hint caps, escape
  hatch), `TutorSheet`, diagnostics components (take/skip/cancel/resume, 4–12 items),
  and the remediation/attempt structures predate this change.

## 1.2 Native lesson persistence (implemented)

- Migration `146_study_plan_lessons`; model `StudyPlanLesson`; repository
  `study_plan_lesson_repository.rs`; commands in `study_lessons.rs`.
- Verified by native tests (`cargo test study_plan_lesson_repository` → 2 passed):
  - create → reopen same key returns same lesson (idempotent Start);
  - checkpoint under expected revision persists draft answer + hint count + turn count;
  - duplicate delivery of same request id + payload is a no-op (revision unchanged);
  - stale expected revision rejected (`stale_revision`);
  - restart restores last committed state;
  - style switch persists without mutating historical turn counts.

## 2.1 Route + Start/Continue (implemented)

- Editor per-node “Start lesson” (requires a selected topic) opens `LessonView`;
  `createStudyPlanLesson` returns the existing lesson on reopen → Continue restores at
  the same objective.
- If the pinned source revision snapshot differs from the current plan scope, the view
  shows an explicit recovery banner instead of silently rebinding.
- UI test: `StudyPlanEditor.test.tsx` (start/l finishes, create call asserted).

## 1.3 Tutor authority/preflight (implemented + tested)

- `StudyTutorHost` (→ `buildStudyTutorContext` + `checkStudyTutorPrivacy`) enforces the pinned
  authority and endpoint preflight for library-backed lessons; model-only lessons never
  build a source context (zero retrieval).
- Tests (`src/components/study-plans/tutoring/__tests__/studyTutorAuthority.test.ts`, 7/7):
  strict scoped retrieval (unauthorized ref → denied), missing/stale source context denied,
  model-only zero-retrieval denial, AI-excluded denial, local-only + off-device denial,
  consent invalidation on resume/provider switch, billable-without-cost-consent denial.

## 2.2 Lesson styles + handoff (implemented + tested)

- `TutorSessionConfig.openingStyle`: guided (default, one focal question), explain-check
  (short explanation prelude then question), challenge (application framing then question).
- Tests (`src/lib/ai/tutor/__tests__/styles.test.ts`, 5/5): one focal question per turn,
  prelude ordering, hint-cap (3rd hint → forced explain-and-check) and stuck-probe
  escalation via the policy machine, style switch never mutates a prior transcript.
- `LessonView` exposes “Practice independently” → explicitly chosen assessment route;
  lesson turns never write grades/evidence (no grade tables are touched by lessons).

## Not yet complete

- 2.3 diagnostic wiring; 3.1/3.2 journeys (device/accessibility matrix, final bench).
