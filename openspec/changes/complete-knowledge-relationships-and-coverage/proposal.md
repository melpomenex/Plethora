## Why

P1: prerequisite inference reaches the selection sheet, but learners cannot inspect actual library coverage or manage cross-document relationships. Existing relational infrastructure should become a usable evidence workflow without claiming mastery.

## Current Verified Behavior

`SelectionActionsSheet.tsx:469` runs `runPrerequisiteAnalysis` and renders concept/why only. The documented `src/lib/ai/concepts/coverage.ts` does not exist. `ConceptRepository` already normalizes names and persists typed links, acceptance, dismissal fingerprints, deletion and backlinks; these commands are registered in `src-tauri/src/lib.rs:1885`. No frontend command callers were found. Existing graph views expose document/extract/card/tag relationships rather than these concept commands. See [audit](../../planning/ai-learning-completion-audit.md).

## What Changes

- Complete prerequisite cancellation, provider/consent gating and deterministic evidence assessment over shared retrieval and actual source records.
- Resolve canonical concepts, cap typed proposals and connect persistent accept/dismiss/edit/remove/backlink navigation.
- Separate evidence completeness from historical encounter/study/review activity and from mastery.
- Supply the bounded agent's optional relationship proposal adapter after these contracts work independently.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-knowledge-relationships`: evidence-based coverage, typed relationship lifecycle and related-content discovery.

## Scope and Non-goals

No graph database, second index, automatic synonym merge, mastery scoring or background relationship generation. Do not reimplement prerequisite inference or backend CRUD already present. Passage scoring is owned by the separate reader change.

## Impact

Selection results, concept API wrappers and coverage orchestrator, graph/concept detail UI, `ConceptRepository`, optional agent link adapter. Users gain navigable evidence and inspectable relationships, while user ratings and scheduler state remain authoritative.

## Dependencies

Initialization 1.1 and diagnostics 1.1 contracts; shared semantic retrieval and existing concept commands. Does not require the agent or passage controller to ship. Agent relationship integration follows this change's public adapter.

## Compatibility Risks

Existing spec coverage labels mix activity and evidence; retain legacy activity values separately. Acceptance currently changes `created_by` to user, so immutable AI origin must survive in provenance. Existing caller-side caps/thresholds and endpoint validation require backend defense before exposing untrusted model references.

## Definition of Done

Selection → prerequisites → deterministic coverage/evidence → source navigation → explicit link acceptance/dismissal works through production entry points, survives restart and avoids duplicate graph entries. Unindexed content yields unknown, never proof of absence or mastery. Backend and UI tests cover stale/deleted evidence, edits, concurrency and persistence failures.
