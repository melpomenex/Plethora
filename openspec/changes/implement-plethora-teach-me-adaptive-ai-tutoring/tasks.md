# Implementation Tasks

## 1. Lesson engine
- [x] 1.1 `src/lib/ai/tutor/lesson.ts`: stage machine + skip/compose rules + resumable session state
- [x] 1.2 Diagnosis calibration from mastery/gap context (10) + variance handling
- [x] 1.3 Evaluate output schema `{verdict, misconception?, missing_prerequisite?}` + adaptation ladder rules
- [x] 1.4 Remediation via graph prerequisite walk (9) fallback to re-explain
- [x] 1.5 Tasks: extend `tutor-turn` set with lesson-stage prompts (grounding via rag_query, beyond-library label)

## 2. UX
- [x] 2.1 Evolve `TutorSheet` → LessonSheet (stage indicator, inline evaluate feedback, remediation markers, end summary)
- [x] 2.2 Mobile sheet + desktop panel + e-ink text variant; session persistence/resume
- [x] 2.3 Entry points: SelectionActionBar chip, graph node, gap card, path node, palette (`startLesson` routing API)
- [x] 2.4 Weakness-derived card proposals via 13 preview flow + `lesson-completed` event

## 3. Routing & quotas
- [x] 3.1 Model routing via runTask classes (Nano/BYO un-gated); hosted tier capability gate + turn quota + degradation reason
- [x] 3.2 Privacy disclosure copy for cloud lesson turns

## 4. Validation
- [x] 4.1 Fixture-dialogue tests (adaptation ladder, remediation targeting, grounding labels, citation validation)
- [x] 4.2 Weakness-card seeding tests (preview-only acceptance); resumability tests
- [x] 4.3 i18n 6 locales; full gates (vitest/cargo/bench:check/build:check)

