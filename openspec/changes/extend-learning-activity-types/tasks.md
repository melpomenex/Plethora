# Tasks: Extend Learning Activity Types

## 1. Registry & Capability Negotiation Core
- [ ] Define `ActivityTypeManifest`, `ActivityCapability`, `RuntimeEnvironment`, and `NegotiatedActivityResult` types in `src/lib/activities/types.ts`.
- [ ] Implement `LearningActivityRegistry` in `src/lib/activities/registry.ts` with duplicate-ID protection, lazy surface loading, and capability-negotiated lookup (`< 2 ms`).
- [ ] Implement `src/lib/activities/capabilities.ts` handling platform (`desktop` | `mobile` | `pwa`), offline state, AI availability, microphone availability, and `isLocalOnly`/`isAiExcluded` document privacy negotiation.
- [ ] Write unit tests for registry registration, capability negotiation matrices, and fallback resolution.

## 2. 13 Initial First-Party Activity Adapters
- [ ] Implement and register existing-surface adapters reusing canonical components: `incremental_reading` (`DocumentViewerWrapper`), `flashcard_review` (FSRS-7), `extract_processing`, `guided_reading_trail`, `socratic_dialogue` (with zero-AI self-prompt fallback), `formative_check`, `formal_examination`, `language_production_practice`, and `exploratory_feed_digest`.
- [ ] Implement and register new first-party activity adapters: `worked_example_study` (step-reveal + self-explanation), `problem_solving_drill` (multi-step + staged hints + rubric), `code_tracing_and_synthesis` (read-only trace table & rubric, zero OS execution), and `synthesis_and_concept_mapping` (free-recall + Knowledge Atlas link authoring).
- [ ] Wire every adapter's `serializeResumeState` and `emitLearningEvent` hooks to the Unified Learning Activity Runtime (`unify-learning-activity-runtime`) and DAQE candidate metadata.
- [ ] Verify backend `learning_events` ingestion allow-lists all 13 activity types and validates required metadata fields.

## 3. 5 Declarative Subject Templates
- [ ] Create declarative subject template definitions in `src/lib/activities/templates/` for `mathematics`, `computer_science`, `philosophy`, `languages`, and `history_literature`.
- [ ] Wire subject template selection into Learning Goal creation/editing and Study Plan setup flows (copy-on-create so user edits never mutate built-in templates).
- [ ] Add unit tests validating all 5 templates reference only registered activity IDs and have competency weights summing to `1.0`.

## 4. Security Extension Boundary
- [ ] Implement `src/lib/activities/sandboxBridge.ts` enforcing isolated Worker/iframe (`sandbox="allow-scripts"`, no `allow-same-origin`, no Tauri IPC), strict `postMessage` schema validation, `256 KB` payload cap, rate limiting (`20 msg/s`), and explicit capability grant checks.
- [ ] Enforce host-side privacy redaction so `isLocalOnly` and `isAiExcluded` document content is never passed to untrusted extensions, and enforce event-kind restrictions preventing extensions from emitting `formal_exam_grade` or mutating FSRS-7 intervals.
- [ ] Add security unit tests covering oversized payloads, undeclared capabilities, forged exam grades, and `isLocalOnly`/`isAiExcluded` blocking.

## 5. Verification & Bundle Budget Check
- [ ] Verify lazy chunk splitting of all 13 activity adapters against `scripts/bundle-budgets.json` via `npm run check:bundle`.
- [ ] Run `npx tsc --noEmit`, `npx vitest run src/lib/activities`, and `cd src-tauri && cargo test`.
