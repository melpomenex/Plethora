## Why

Manual Study Plans are durable after Change 1, but converting a large selected library scope into a coherent prerequisite-aware curriculum still requires manual topic decomposition. Plethora should generate inspectable curricula from bounded, validated source evidence without trusting model ids/citations, sending whole books to a model, or overwriting user edits.

## What Changes

- Add a staged curriculum generation coordinator over frozen source scopes: seed/retrieve evidence, decompose small batches, reconcile canonical concepts/duplicates, propose handle-bound prerequisites, validate DAG/source coverage, preview and explicitly publish a version.
- Add reasoning/full registered task pairs for topic decomposition and prerequisite proposals using contained untrusted excerpts and fail-closed output validation.
- Add a deterministic no-AI outline from confirmed concepts and source inventory, with its reduced semantics clearly labelled.
- Introduce a narrow durable Study Generation Job/step ledger with bounded concurrency, per-batch checkpoints, lease/cancellation protection, interruption recovery and consent-aware explicit resume.
- Preserve locks, user additions/edits/removals and plan-head conflicts during generated version drafts; surface unsupported prerequisites/material gaps rather than hiding them.
- Reuse existing retrieval, concepts, coverage, provider/privacy/destination and source-reference infrastructure. Define an optional prior-evidence contract but leave its diagnostic producer/UX to Change 7.

## Capabilities

### New Capabilities

None. Curriculum generation belongs to the existing `adaptive-learning-paths` capability.

### Modified Capabilities

- `adaptive-learning-paths`: Specify bounded source-grounded generation, deterministic ordering independent of unavailable mastery, rules-only operation, job recovery, explicit adaptation and user-edit preservation.

## Impact

- **Frontend:** new `src/lib/study-plans/generation/*`, two AI task-definition modules, source/budget orchestration and generation preview/progress UI in `src/components/study-plans/`.
- **Native:** one fresh-numbered job/step migration, repository and commands; modifies shared migration and command registration only after C1.
- **AI/privacy:** all tasks use `runTask`, registered reasoning twins, containment and endpoint-aware preflight. No agent auto-write, silent remote fallback or full-document prompt.
- **Compatibility:** published C1 plans remain authoritative during drafts. C3/C5 will reuse the job contract; C2 never reads future attempt/evidence tables.
- **Active changes:** does not touch or depend on `design-source-grounded-ai-curricula-and-assessments`.
