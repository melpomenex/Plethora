## Why

Study Plans need configurable assessments, but Plethora currently has card-generation/review assessment rather than persistent exam blueprints, mixed-format fixed papers, multi-select/essay items or immutable committed keys/rubrics. This change creates the source-grounded assessment artifact and preview layer before any learner attempt begins.

## What Changes

- Add durable blueprint containers/revisions bound to a plan version or custom frozen source scope, with mode, 1–40 length, type/difficulty/topic weights, timer, knowledge policy, repeat exclusions and scoring validation state.
- Implement deterministic largest-remainder quotas and stable per-kind/topic/difficulty slots, honest deficit reports and explicit shortfall acceptance.
- Add a discriminated typed question model for single-select, multi-select, segmented cloze, short answer and long-form/multi-step essay; store separate public content, committed answer key and analytic rubric payloads.
- Add source-handle question generation in mobile-bounded batches using Change 2's job ledger, source refs and privacy preflight, with schema/gradeability/source/duplicate validation at every checkpoint.
- Implement exam builder, generated/manual question editor and preview/publication, including clear answer-key/rubric/provenance inspection before Start. Committed question revisions cannot change; edits after Ready create another revision.
- Support valid manual question authoring without AI. Saved Ready papers remain usable offline. Diagnostics remain a recognized mode whose actual entry/adaptation belongs to Change 7.

## Capabilities

### New Capabilities

- `assessment-blueprints`: Durable configurable fixed assessments, validated question revisions, committed answer keys/rubrics, source provenance, quota shortfall handling and provider-aware generation/preview.

### Modified Capabilities

None. Existing card generation, `ai-answer-assessment`, `adaptive-learning-paths` and the active card-quality change keep their current ownership.

## Impact

- **Frontend:** new `src/types/assessmentQuestions.ts`, `src/lib/study-plans/assessments/*`, question task/schema modules, `src/api/assessment-blueprints.ts` and builder/editor/preview components under `src/components/study-plans/assessments/`.
- **Native:** additive blueprint/question migration with committed-revision trigger; new repositories/models/commands and command registration.
- **Reuse:** C1 source refs/source-scope; C2 jobs/preflight/task patterns; existing answer/coverage/retrieval/card-grounding ideas. No `learning_items` rows.
- **Privacy/provider:** explicit selected-excerpt disclosure, frozen route and checkpointed generation; no paid/live inference in tests or silent remote fallback.
