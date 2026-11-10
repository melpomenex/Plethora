## Why

Plethora's adaptive-learning-path archive claims a complete curriculum subsystem, but the live tree contains only defective localStorage types/store code with no production consumer. A trustworthy learning workflow first needs durable, manually useful, source-linked Study Plans that survive restart without AI and without creating a second authority beside the legacy store.

## What Changes

- Replace authoritative learning-path localStorage with SQLite-backed Study Plans, durable goal text, frozen source scopes, plan/node identities, drafts, published versions and optimistic revisions.
- Provide a first-class native Study Plans destination for manual create, source selection, topic/objective authoring, prerequisite editing, dependency-safe reorder, lock/remove, explicit completion/activity, version diff, history, archive and reopen.
- Add strict cycle/dangling-edge/position validation and deterministic topological sequencing; do not reuse the current silent cycle recovery or lossy reorder behavior.
- Introduce reusable `StudySourceRefV1` records with verified excerpts/revisions and exact PDF/EPUB/text/audio/YouTube or extract/video-extract navigation states.
- Import the legacy `plethora-learning-paths` payload through explicit validation and idempotent persistence, then disable the old writable authority only after successful import.
- Provide native whole-database backup behavior and an explicit unsupported-store state elsewhere; no AI provider is needed for this change.

## Capabilities

### New Capabilities

None. Study Plans is the product name for the existing curriculum capability, not a near-duplicate capability.

### Modified Capabilities

- `adaptive-learning-paths`: Replace goal/path persistence semantics with a durable plan-owned goal and version history; add native authoring, strict DAG/order, source-reference lifecycle, legacy migration and offline behavior.

## Impact

- **Frontend:** verified existing `src/types/learningPaths.ts`, `src/stores/learningPathsStore.ts`, navigation/registries/i18n; new `src/api/study-*.ts`, `src/lib/study-plans/*` and `src/components/study-plans/*` modules.
- **Native:** additive migration in `src-tauri/src/database/migrations.rs`; new source/plan models, repositories and Tauri commands registered through existing command infrastructure.
- **Compatibility:** best-effort validated legacy localStorage import; browser/PWA cannot silently pretend native writes succeeded.
- **Boundaries:** no AI call, queue feed, FSRS/review mutation, document duplication, global concept-link acceptance, settings control or sync EntityType change.
- **Reference contracts:** `openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md` and `04-DATA-AND-MIGRATION-PLAN.md`.
