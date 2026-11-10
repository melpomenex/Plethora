## Context

The live learning-path implementation is an orphan Zustand/localStorage scaffold. `createPath` does not rebind node path ids, reorder can drop/duplicate nodes, duplicate ids/goals are unchecked, and `generateLearningPathTopology` ignores dangling edges and appends cyclic nodes. There are no source locators, durable versions or production views. This change establishes a small native aggregate usable before any AI work.

Run B contracts are normative: shared types/commands in `../../planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md`, tables/migrations in `04-DATA-AND-MIGRATION-PLAN.md`, and ADR-01–07/21–22 in `10-ARCHITECTURAL-DECISIONS.md`.

## Goals / Non-Goals

**Goals:**

- Manual-first Study Plans with durable goal/scope/nodes/activity and compile-safe API slices.
- One native authority, strict graph/order semantics, explicit version drafts/diffs and safe source lifecycle.
- Reachable native desktop/mobile UI with no inference.
- Validated idempotent legacy import and honest unsupported browser behavior.

**Non-Goals:**

- AI generation, jobs, assessment/exam types, mastery/gaps, tutor changes or queue integration.
- Two-way sync/app-state JSON support, PWA IndexedDB implementation, global concept-link writes.
- Modifying the active card-quality change or existing review/scheduler behavior.

## Decisions

### Aggregate and editing

Use the exact C1 DDL in the data plan. `StudyPlan` owns its goal; no `study_goals` table exists. Logical ids live across version-node copies. Draft saves replace the complete draft graph transactionally under CAS; this is simpler and safer than split per-widget mutation commands. Publish is the only head-switch operation. Included=false tombstones retain user removals for C2.

The current `LearningPath*/PathNodeStatus` names may remain as deprecated aliases only if needed during a single-file migration, but exported canonical types are the Study Plan types in shared contracts. Remove inert estimated/target mastery fields and the unsafe topology implementation rather than preserving their broken semantics.

### Source references

Use `StudySourceRefV1`, not `CardSourceReference`, because multi-ref evidence, strict per-kind fields and historical deletion/revision states are required. Creation rehydrates live source content and computes hashes/revisions in Rust. Persist bounded excerpt plus optional jump/chunk/extract coordinates; semantic chunks are cache hints. Navigation dispatches through `openDocumentAtLocation`, `chunkLocationToSearchHit` or focused extract/video-extract tab payload according to source type.

### Frontend store and UI

`useLearningPathsStore` becomes a non-persisted API cache: summaries, selected plan id/version id, hydration/loading/error and editor mutation intents only. It never writes localStorage or fabricates native rows. The new Study Plans tab uses an ordered outline with optional dependency details, not a mandatory graph editor.

No Settings controls are added; settings-search catalog/coverage changes are therefore not required. All product strings use `src/lib/i18n/locales/en.ts` and matching supported locale dictionaries. Browser/PWA is explicitly refused by native capability detection rather than accepting browser-backend default values.

### Migration/legacy import

Append one fresh-numbered migration containing the C1 tables and indexes. Import reads `plethora-learning-paths` at the Study Plans boundary, validates all rows, and sends canonical payload+hash to Rust. Retry uses `legacy_import_key`; any malformed rows remain visible/recoverable. Only accepted commit renames the original key to a backup key. No Zustand `migrate` function creates a second persistent store.

### Transactions

Create, Save Draft, Publish, Import, Set Activity, Archive and Delete are each repository transactions. Head and draft CAS use plan `revision`; draft content additionally validates version id and base. Source refs and node/edge associations commit with their owner. Delete Plan leaves assessments by nullable detach columns introduced in C3; library rows are never touched.

## Risks / Trade-offs

- **Circular head/version FKs** → create plan with null pointers, version/content second, pointers last in one transaction; add repository same-plan assertions.
- **Legacy corrupt graphs** → keep in Draft with explicit issues; no topological “repair” that invents edges.
- **Whole-document draft replacement** → bounded at 100 nodes and convenient for weaker implementation; source refs are deduped by content unique index.
- **Stale source excerpts retained** → required for audit/offline history; provide explicit plan/history deletion and missing-source disclosure.
- **Native-only artifact storage** → deliberate scope; unsupported platforms see refusal rather than silent data loss.

## Migration Plan

1. Land types/strict pure topology with tests before native writes.
2. Append/add-test migration, implement repositories/source resolver, then commands/wrappers.
3. Replace store authority and implement legacy import before exposing editor writes.
4. Add navigation and UI in vertical create→edit→reopen slices.
5. Run Rust/Vitest/navigation/i18n/accessibility checks and native qualification.

There is no destructive rollback. Existing malformed localStorage remains backed up until successful import. Payload major-version readers fail closed in older builds.
