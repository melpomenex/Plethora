# Change: Implement Plethora "Teach Me" Adaptive AI Tutoring

> Wave 2 — Intelligence (extends an existing subsystem; hard-depends on 7; benefits from 10). Capability: `ai_tutoring` for Plethora-hosted model access; BYO/on-device tutoring already works today and stays ungated.

## Why

"Explain" is one-shot. **Teach me** is an interactive mini-lesson: diagnose prior understanding → explain → analogy → example → ask → evaluate answer → adapt difficulty → remediate misconceptions → generate flashcards from actual weaknesses. Entry points: text selection, a concept (graph), or a detected knowledge gap (10). The app already has most machinery — this change composes it into a structured, adaptive lesson flow.

## What exists today (substantial)
- **Socratic tutor core**: `src/lib/ai/tutor/session.ts` (state machine, 24-turn cap, hint-level bounds, escape hatch, retrieval refresh), `context.ts` (last 6 turns + distilled summary), tasks `tutor-turn`/`tutor-turn-full` (`tutorTask.ts` with reasoning fallback), UI `src/components/tutor/{TutorSheet,TutorComposer,TutorTurnBubble}.tsx`.
- **Assessment**: `assess-answer` task + `answer_assessments` table (grading of free answers with per-item history); semantic grading in review (`semanticGrading` utils).
- **Recall**: `recall-question` task + prompts/overlays with interruption policy.
- **Card generation**: studio AI (`flashcardStudioAI.ts`, knowledge-formulation engine — Wozniak's 20 rules in `knowledgeFormulation.ts`), pending-cards flow (`pendingFlashcardsStore`, `ChatFlashcardCollection`).
- **Prerequisite analysis** task; retrieval (`ai_learning_retrieve`/7's `rag_query`); provenance recording.

## What Changes

### 1. Lesson orchestration (`src/lib/ai/tutor/lesson.ts`)
- A **lesson plan state machine** on top of the existing session: stages `diagnose → explain → analogy → example → check (question) → evaluate → adapt-loop → remediate → consolidate (cards)`. Stages are skippable/composable per content type; the existing turn-cap and context distillation are reused.
- **Diagnosis**: 1–2 calibrated questions probing prior understanding (uses mastery estimate from 10 when available to calibrate starting difficulty; variance respected — wide variance → start broader).
- **Adaptation rules**: difficulty ladder on evaluate outcomes (correct+fast → deepen; correct+hesitant → consolidate with second angle; incorrect → remediate: re-explain from the failed prerequisite, using graph `prerequisite-of` walk from 9); misconception detection patterns in evaluate output (structured: `{verdict, misconception?, missing_prerequisite?}`).
- **Grounding**: every explanation turn retrieves via `rag_query` scoped to the user's library first; when the library lacks coverage, the tutor says so and either uses its parametric knowledge clearly labeled ("beyond your library") or suggests Find-material. Citations via `CitationChips` (7).
- **Consolidation**: at lesson end (or user request), propose cards **from demonstrated weaknesses** (failed checks, remediated misconceptions) through the 13's preview/edit/accept flow — never auto-created.

### 2. Entry points
- Selection ActionBar ("Teach me" alongside Explain/Ask — `SelectionActionBar.tsx` additive chip).
- Concept node in graph (9) and gap card (10) via the action-routing contract.
- Reader margin concept affordance; command palette; path nodes (11).

### 3. UX
- Evolve `TutorSheet` into **LessonSheet**: stage indicator, progress through mini-lesson, evaluate feedback inline, misconception remediation clearly marked, end-of-lesson summary (what was weak, what was taught, cards proposed). Mobile bottom-sheet + desktop side panel (existing patterns); e-ink text-first rendering.
- Session persistence: lessons resumable (existing conversation persistence patterns extended with lesson state).

### 4. Model routing
- Reuse `runTask` model-class routing (`fast`/`full`/`reasoning` with fallbacks); on-device Nano serves basic lessons (already the fallback path); BYO cloud providers work ungated (user pays provider); **Plethora-hosted premium models** for lessons = `ai_tutoring` capability (quota: lesson-turns/month), disclosed data flow (lesson turns + retrieved excerpts leave device when cloud route used).

## Impact

### Affected Specs
- `adaptive-tutoring` — New (lesson stages, diagnosis calibration, adaptation rules, grounding + beyond-library labeling, weakness-derived cards, quotas).

### Affected Code Areas
- `src/lib/ai/tutor/` (lesson orchestrator + tasks), `components/tutor/` (LessonSheet evolution), `SelectionActionBar` chip, entry-routing helpers; i18n. Minimal Rust changes (answer_assessments reuse; optional `tutor_lessons` persistence if not folded into existing QA session storage — prefer localStorage/existing `documentQAStore` patterns; no migration needed v1).

### Non-goals
- No voice tutoring (TTS reading of turns may compose later via 17), no multi-student/classroom, no grading exports, no changes to the review scheduler.

## Dependencies

### Hard dependencies
- 7 (rag_query + citations). Soft: 9 (prerequisite walks), 10 (mastery calibration), 13 (card proposals), 2 (capability gate for hosted tier).

### May run concurrently
- 13, 14, 15 (disjoint; shared consumption of tasks/assessments APIs).

### Must not start yet
- —.

## Shared interfaces
- `startLesson(context: SelectionRef | ConceptRef | GapRef)` routing API (consumed by 9/10/11 entry points); lesson-state persistence schema; `lesson-completed` event (with weakness summary, consumed by 10/15 signals opt-in).

## Ownership boundaries
- **May modify**: tutor module/UI/tasks, selection-bar chip, its stores.
- **Must treat as external**: task engine, assessment storage APIs (additive reads/writes only), card-studio flow (13 owns; lessons call its proposal API), graph/gap queries.

## Collision risks
- `tutor/` module (owned here entirely); `SelectionActionBar` (8 also adds a chip — additive list); `assistant` panels untouched.

## Integration contract
- Consumes `rag_query`, graph `prerequisite-of` walks, mastery estimates; produces weakness-annotated assessments (existing `answer_assessments` with metadata) and card proposals via 13's preview flow.

## Testing & acceptance

### Tests
- Lesson state machine: stage transitions, skip/compose rules, turn-cap behavior, resumability.
- Adaptation: fixture dialogues — correct/fast vs incorrect paths produce deepening vs remediation; remediation targets the failed prerequisite (graph fixture).
- Grounding: library-scoped answers cite; beyond-library labeling appears when retrieval is empty; no fabricated citations (marker validation reused).
- Weakness-derived cards: only failed/remediated checks seed proposals; acceptance goes through preview (never direct creation).
- Interruption/e-ink: lesson UI renders text-first; mobile sheet behaviors.
- Quota: hosted-tier turn counting; degradation to on-device with reason when exhausted.

### Acceptance criteria
- From a selection, a concept, and a gap, a full mini-lesson runs with adaptation, citations, misconception remediation, and optional card proposals; sessions persist and resume; Free users get the full flow on Nano/BYO; hosted tier gates cleanly.

### Must remain unchanged
- Existing tutor turns (non-lesson usage), recall prompts, review flow, task-engine behaviors.

## Open questions
1. Lesson turn-quota unit sizing (turns vs tokens) for the hosted tier.
2. Whether lesson summaries feed mastery estimates directly (default: yes, weighted low, via 10's estimator).
