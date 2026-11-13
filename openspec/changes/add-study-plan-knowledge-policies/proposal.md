## Why

Study Plan curriculum generation currently forces Library Only and requires selected documents, even though the assessment builder already distinguishes two library-backed policies. Learners need to choose what counts as authority before they generate a plan, including when they have no library materials.

## What Changes

- Offer Library Only, Library + AI Knowledge, and AI Knowledge Only, independently of manual authoring, AI generation, and deterministic source outline.
- Freeze the authority on each plan version; show revisioned library citations, explicit AI supplements/conflicts, or unverified model output as appropriate.
- Add a bounded source-free generation and self-check path. Keep verified exam eligibility tied to independently verified questions and answer keys.
- Show goal, source readiness, provider, data destinations, budget, and an editable preview before publication; retain the existing manual and no-model outline paths.
- This is the foundation for Adaptive Learning Studio (PRD SP-01–06, SP-09–10, SP-16). Lesson sessions, Plan Home, motivation, and Web Research are separate changes.

## Capabilities

### New Capabilities

- `study-plan-knowledge-policy`: Versioned authority, provenance, model-only generation and practice, and execution disclosures for Study Plans.

### Modified Capabilities

- `adaptive-learning-paths`: Allow policy-gated model proposals while retaining source-derived outlines, deterministic ordering, and visible material gaps.

## Impact

Study Plan creation/editor UI, TypeScript and native plan-version contracts, SQLite migration, curriculum jobs, shared preflight, source navigation, and assessment/evidence guards. The existing source-backed assessment engine and C1–C8 artifacts remain the baseline.
