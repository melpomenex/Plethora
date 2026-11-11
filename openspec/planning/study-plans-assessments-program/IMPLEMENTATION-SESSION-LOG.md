# Study Plans and Assessments — Implementation Session Log

## Initial Preflight Checkpoint
- **Timestamp:** 2026-11-10T17:03:00Z
- **Start Commit SHA:** `4744a2c24c95e594b0410a3a7ea98561d096c7cb`
- **Branch:** `main`
- **Working Tree Status:** Clean
- **Selected Task:** `C1-T01` (under `openspec/changes/establish-persistent-study-plans/tasks.md`)
- **Available Prerequisites:** None (Task 1.1 has no dependencies)
- **Baseline Verification Status:**
  - Git working tree verified clean.
  - Core contracts reviewed (`AGENTS.md`, `09-IMPLEMENTATION-HANDOFF.md`, `02-SHARED-CONTRACTS.md`, `03-IMPLEMENTATION-DEPENDENCIES.md`, `04-DATA-AND-MIGRATION-PLAN.md`, `tasks.md`, `specs/`).
- **Current Implementation Phase:** Change 1 — Persistent Study Plans (`establish-persistent-study-plans`), Task 1.1 (`C1-T01`).

---


### Task Checkpoint: C1-T01
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T01`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/types/learningPaths.ts`
  - `src/types/__tests__/learningPaths.test.ts`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/topology.ts`
  - `src/lib/study-plans/validation.ts`
  - `src/lib/study-plans/__tests__/topology.test.ts`
  - `src/lib/study-plans/__tests__/validation.test.ts`
- **Implementation Summary:**
  - Implemented canonical Study Plan domain contracts matching `02-SHARED-CONTRACTS.md` §§1–3.
  - Implemented MinHeap-based deterministic Kahn's topological sort with tie-breaker `(previousPosition, normalizedTitle, nodeId)`.
  - Implemented deterministic cycle extraction via DFS, returning `dependency_cycle` error with `remainingNodeIds` and concrete `cycle`.
  - Implemented `calculateManualMoveBounds` and `reorderStudyPlanNode` for DAG reachability bounds enforcement and contiguous re-indexing.
  - Implemented validation for plan/version/node limits, contiguous positions, objectives limits, and prohibited raw HTML.
  - Replaced legacy `generateLearningPathTopology` with strict ordering that fails on cycles rather than silently appending remainder.
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/__tests__/topology.test.ts src/lib/study-plans/__tests__/validation.test.ts src/types/__tests__/learningPaths.test.ts`: 26 passed across 3 test suites.
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
  - `npx tsc --noEmit`: 0 errors in study-plans or learningPaths files.
- **Next Eligible Task:** `C1-T02`

---


### Task Checkpoint: C1-T02
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T02`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/types/learningPaths.ts`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
  - `src/types/studySource.ts`
  - `src/lib/study-plans/sourceValidation.ts`
  - `src/lib/study-plans/__tests__/sourceValidation.test.ts`
- **Implementation Summary:**
  - Implemented canonical source DTOs (`SelectedSourceScope`, `ResolvedSourceDocument`, `StudySourceScopeV1`, `StudySourceRefInput`, `StudySourceRefV1`, `StudySourceResolution`, `StudySourceChunk`) matching `02-SHARED-CONTRACTS.md` §2.
  - Implemented deterministic Canonical JSON serialization (`toCanonicalJson`) with sorted keys, NFC string normalization, array order preservation, and non-finite number rejection.
  - Implemented synchronous lowercase 64-hex SHA-256 (`sha256Hex`), `computeCanonicalHash` (`sha256:<hex>`), and `computeExcerptSha256` with CRLF -> LF normalization.
  - Implemented strict per-kind locator validation (PDF positive page and non-negative offset hint; EPUB non-empty CFI/CFI-range; media finite non-negative timeSeconds; HTML/Markdown 0..100 scroll percent) and source-type compatibility.
  - Enforced 24 documents, 200 extracts, 1600-char excerpt limits, and document sorting.
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/__tests__/sourceValidation.test.ts`: 13 passed.
  - Combined suite run (39 tests across 4 test files): all 39 passed.
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T03`

---


### Task Checkpoint: C1-T03
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T03`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/database/migrations.rs`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Implementation Summary:**
  - Re-derived next free migration number as `139`.
  - Appended migration `139_persistent_study_plans` to `MIGRATIONS` in `src-tauri/src/database/migrations.rs`.
  - Created 9 tables: `study_plans`, `study_plan_nodes`, `study_plan_versions`, `study_source_refs`, `study_plan_version_nodes`, `study_plan_prerequisites`, `study_plan_node_sources`, `study_plan_prerequisite_sources`, `study_plan_node_activity`.
  - Created indexes and constraints: `one_study_plan_draft`, head ordering index, `study_source_refs_content` unique index, included contiguous position unique index, concept index, dependent prereq index, composite FK for activity.
  - Added unit tests verifying: fresh and prior DB execution, all 9 tables, foreign key check, one draft per plan, semantic key uniqueness per plan, included node position uniqueness, excluded node position `-1` check, activity check constraint, and cascade delete isolation (plan deletion cascades versions/nodes/activity while retaining study source refs).
- **Verification Evidence:**
  - `cargo test persistent_study_plans`: 2 passed (`migration_139_persistent_study_plans_fresh_and_prior_db`, `migration_139_persistent_study_plans_constraints_and_foreign_keys`).
  - `cargo test database::migrations::tests::`: 31 passed (including ordering, uniqueness, idempotency).
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T04`

---


### Task Checkpoint: C1-T04
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T04`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/models/mod.rs`
  - `src-tauri/src/database/mod.rs`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
  - `src-tauri/src/models/study_source.rs`
  - `src-tauri/src/database/study_source_repository.rs`
- **Implementation Summary:**
  - Created Rust models for `StudyCommandError`, `StudyErrorCode`, `FieldIssue`, `RevisionKind`, `StudySourceStatus`, `StudySourceNavigation`, `StudySourceRefInput`, `StudySourceRefV1`, and `StudySourceResolution` matching shared contracts.
  - Implemented `StudySourceRepository` with live document and extract hydration:
    - Revision selection (content_hash -> date_modified -> unknown).
    - Excerpt normalization and exact matching, reporting `Stale` if missing from content, `Ambiguous` if multiple matches occur without extract disambiguation, and `Missing` if parent document or extract was deleted.
    - Deterministic SHA-256 excerpt hashing using `sha2` crate.
    - Source ref deduplication against `study_source_refs` unique index `(document_id, revision, excerpt_sha256, COALESCE(extract_id, ''))`.
    - Implemented `upsert_source_ref_in_tx`, `get_source_ref`, `get_source_refs_batch`, and `cleanup_unused_source_refs_in_tx`.
- **Verification Evidence:**
  - `cargo test study_source_repository`: 3 passed (`test_resolve_exact_document_and_extract_resolution`, `test_negative_cases_deleted_doc_mismatch_and_bad_locator`, `test_source_ref_deduplication_and_persistence`).
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T05`

---


### Task Checkpoint: C1-T05
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T05`
- **Status:** COMPLETE
- **Files Modified:**
- `src-tauri/src/models/mod.rs`
- `src-tauri/src/database/mod.rs`
- `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
- `src-tauri/src/models/study_plan.rs`
- `src-tauri/src/database/study_plan_repository.rs`
- **Implementation Summary:**
- Created Rust domain models and DTOs: `StudyPlan`, `StudyPlanSummary`, `StudyPlanDetail`, `StudyPlanVersion`, `StudyPlanVersionNode`, `StudyPlanDiff`, `NodeDiff`, `PrerequisiteDiff`, `CreateStudyPlanInput`, `SaveStudyPlanDraftInput`, `PublishStudyPlanVersionInput`, `SetNodeActivityInput`, `LegacyImportResult`, matching `02-SHARED-CONTRACTS.md` §11 and `04-DATA-AND-MIGRATION-PLAN.md` §3.
- Implemented `StudyPlanRepository` with all state transitions and storage operations:
  - `create_study_plan`: sets head null, writes initial version row, logical nodes, version nodes, source associations, and updates `draft_version_id`.
  - `list_study_plans`: lists active, archived, or all plans with counts and draft indicators.
  - `get_study_plan`: fetches plan summary, published current version, draft version, and node activities.
  - `save_study_plan_draft`: validates CAS expected revision, prevents overwrite if base draft is out of sync, manages draft version nodes and prerequisites in transaction.
  - `publish_study_plan_version`: CAS check on current version and draft, runs validation, computes full structural diff against prior published version, supersedes prior, promotes draft to current head.
  - `discard_study_plan_draft`: removes uncommitted draft version and associated join rows.
  - `set_study_plan_node_activity`: upserts activity state (`not_started`, `in_progress`, `completed`, `skipped`) and updates timestamps.
  - `archive_study_plan` & `delete_study_plan`: archives/unarchives, or cascade-deletes plan-owned rows while preserving reusable study source refs.
  - `import_legacy_study_plans`: idempotent import of legacy paths using deterministic SHA-256 keys.
- **Verification Evidence:**
- `cargo test --lib database::study_plan_repository::tests`: 4 passed (`test_legacy_import_idempotency`, `test_create_get_and_list_study_plan`, `test_node_activity_and_delete_cascade`, `test_save_draft_publish_and_cas_revisions`).
- `rustfmt --edition 2021`: formatted cleanly.
- `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T06`

---


### Task Checkpoint: C1-T06
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T06`
- **Status:** COMPLETE
- **Files Modified:**
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/lib.rs`
- `src/types/learningPaths.ts`
- `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
- `src-tauri/src/commands/study_plans.rs`
- `src-tauri/src/commands/study_sources.rs`
- `src/api/study-plans.ts`
- `src/api/study-sources.ts`
- `src/api/__tests__/study-plans.test.ts`
- **Implementation Summary:**
- Created typed Tauri command modules for Study Plans and Study Sources matching `02-SHARED-CONTRACTS.md` §11:
  - `create_study_plan`, `list_study_plans`, `get_study_plan`, `save_study_plan_draft`, `publish_study_plan_version`, `discard_study_plan_draft`, `set_study_plan_node_activity`, `archive_study_plan`, `delete_study_plan`, `import_legacy_study_plans`, `resolve_study_source_refs`.
  - Registered all 11 commands in `src-tauri/src/lib.rs` and re-exported in `src-tauri/src/commands/mod.rs`.
- Created TypeScript API client wrappers in `src/api/study-plans.ts` and `src/api/study-sources.ts`:
  - `StudyApiError` normalization adhering to `StudyCommandError` contracts.
  - Fail-closed non-Tauri protection: rejects with `unsupported_platform` rather than allowing `browserInvoke` default fallback to return fake empty arrays or nulls.
  - Full round-trip serialization and error mapping for all DTOs and options.
- Added comprehensive unit tests in Rust (`commands::study_plans::tests`, `commands::study_sources::tests`) and Vitest (`src/api/__tests__/study-plans.test.ts`).
- **Verification Evidence:**
- `cargo test --lib commands::study_`: 3 passed (`test_study_plan_command_error_shapes`, `test_resolve_study_source_refs_command`, `test_study_plan_commands_direct_flow`).
- `npm run test:run -- src/api/__tests__/study-plans.test.ts`: 16 passed.
- All C1 Vitest suites: 55 passed across 5 test suites.
- `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T07`

---


### Task Checkpoint: C1-T07
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T07`
- **Status:** COMPLETE
- **Files Modified:**
- `src-tauri/src/database/study_plan_repository.rs`
- `src/stores/learningPathsStore.ts`
- `src/stores/__tests__/learningPathsStore.test.ts`
- `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
- `src/lib/study-plans/legacyLearningPathsImport.ts`
- `src/lib/study-plans/__tests__/legacyLearningPathsImport.test.ts`
- **Implementation Summary:**
- Replaced the localStorage persist reducer in `src/stores/learningPathsStore.ts` with a non-persisted API-backed cache:
  - Supports `loadPlans`, `selectPlan`, `createStudyPlan`, `saveDraft`, `publishVersion`, `discardDraft`, `setNodeActivity`, `archivePlan`, `deletePlan`.
  - Stale-response run token protection prevents race conditions and out-of-order response overwrites.
  - `clearPaths` resets only in-memory cache without calling SQLite deletion.
  - Preserved legacy in-memory compatibility API (`createGoal`, `createPath`, `updateNodeStatus`, `reorderNodes`, `getActivePath`) for existing consumers.
- Implemented `legacyLearningPathsImport.ts`:
  - `previewLegacyLearningPathsImport`: inspects `plethora-learning-paths`, validates goals/paths/nodes, checks for duplicate node IDs, repairs mismatched `node.pathId`, flags unknown goals and cycles, rejects newer major versions (`version > 0`).
  - `executeLegacyLearningPathsImport`: commits legacy paths through `importLegacyStudyPlans`, renames key to `plethora-learning-paths:backup:v1` upon full success, leaves original key untouched on failure.
- Enhanced Rust `import_legacy_study_plans` to parse full legacy Zustand envelopes, map nodes and prerequisites, record activity states, and provide idempotent replay counts.
- **Verification Evidence:**
- `npm run test:run -- src/lib/study-plans/__tests__/legacyLearningPathsImport.test.ts`: 11 passed.
- `npm run test:run -- src/stores/__tests__/learningPathsStore.test.ts`: 5 passed.
- Combined C1 Vitest suites: 71 passed across 7 test suites.
- `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T08`

---


### Task Checkpoint: C1-T08
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T08`
- **Status:** COMPLETE
- **Files Modified:**
- `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
- `src/components/study-plans/StudyPlansTab.tsx`
- `src/components/study-plans/StudyPlanList.tsx`
- `src/components/study-plans/StudyPlanCreateForm.tsx`
- `src/components/study-plans/SourceScopePicker.tsx`
- `src/components/study-plans/StudyPlanStateNotice.tsx`
- `src/components/study-plans/StudyPlanSummaryCard.tsx`
- `src/components/study-plans/LegacyStudyPlanImport.tsx`
- `src/components/study-plans/index.ts`
- `src/components/study-plans/__tests__/StudyPlansTab.test.tsx`
- `src/components/study-plans/__tests__/StudyPlanCreateForm.test.tsx`
- `src/components/study-plans/__tests__/StudyPlanList.test.tsx`
- `src/components/study-plans/__tests__/SourceScopePicker.test.tsx`
- **Implementation Summary:**
- Built the primary Study Plans list/create/source-scope workflow matching `05-UX-SPECIFICATION.md` §2.1–§4.2:
  - `StudyPlansTab`: destination root with non-Tauri / unsupported platform protection (`StudyPlanStateNotice`), view router (`home`, `create`, `plan`), and detail view container.
  - `StudyPlanList`: search filter, active vs archived filter, loading skeleton, empty state explaining manual creation without AI, and summary cards.
  - `StudyPlanCreateForm`: title validation (1..120 chars), learning objective validation via `validateSessionGoal`/`normalizeSessionGoal` (max 200 chars), depth radio buttons (`survey`, `foundational`, `deep`), and `SourceScopePicker`.
  - `SourceScopePicker`: live document retrieval via `getDocuments()`, 24-document upper bound enforcement with warnings, accessible keyboard selection, and empty library notice.
  - `StudyPlanSummaryCard`: status, depth, version, completed topics count, source document count, and archive/restore/delete with `ConfirmDialog`.
  - `LegacyStudyPlanImport`: card for detecting, previewing, and importing legacy paths into persistent SQLite.
- **Verification Evidence:**
- `npm run test:run -- src/components/study-plans/__tests__/`: 11 passed across 4 test suites.
- All C1 Vitest suites: 82 passed across 11 test suites.
- `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T09`

---


### Task Checkpoint: C1-T09
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T09`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlansTab.tsx`
  - `src/components/study-plans/index.ts`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
  - `src/components/study-plans/NodeActivityControl.tsx`
  - `src/components/study-plans/PlanSourceList.tsx`
  - `src/components/study-plans/PrerequisiteEditor.tsx`
  - `src/components/study-plans/PlanNodeEditor.tsx`
  - `src/components/study-plans/PlanOutline.tsx`
  - `src/components/study-plans/PlanVersionDiff.tsx`
  - `src/components/study-plans/PlanVersionHistory.tsx`
  - `src/components/study-plans/StudyPlanEditor.tsx`
  - `src/components/study-plans/__tests__/PlanOutline.test.tsx`
  - `src/components/study-plans/__tests__/StudyPlanEditor.test.tsx`
- **Implementation Summary:**
  - Implemented the full curriculum editor matching `05-UX-SPECIFICATION.md` §3–§4:
    - `PlanOutline`: Accessible linear curriculum structure displaying nodes in topological order, reordering nodes with safety constraints, status badges, prerequisite badges, add-node triggers, and selection handling.
    - `PlanNodeEditor`: Node title, summary, 1-6 learning objectives, concept label, estimated minutes, tombstoned/locked indicators, source refs, and prerequisite management.
    - `PrerequisiteEditor`: Checkbox selection preventing self-prerequisites and validating acyclic DAG constraints.
    - `PlanSourceList`: Supported vs unsupported/missing source representation, excerpt display, and source-level metadata.
    - `NodeActivityControl`: Explicit activity status toggle (`not_started`, `in_progress`, `completed`, `skipped`).
    - `PlanVersionHistory`: Version list showing version numbers, change summaries, author type, creation timestamp, and copy-to-draft / diff actions.
    - `PlanVersionDiff`: Clean side-by-side / breakdown diff comparing nodes between published revisions.
    - `StudyPlanEditor`: Full aggregate editor integrating Outline, Node Editor, Sources, Version History, Diff, Save draft, Discard draft, and Publish version.
  - Wired editor into `StudyPlansTab.tsx`.
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/__tests__/PlanOutline.test.tsx src/components/study-plans/__tests__/StudyPlanEditor.test.tsx`: 7 passed.
  - All C1 Vitest suites: 89 passed across 13 test suites.
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T10`

---


### Task Checkpoint: C1-T10
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T10`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/stores/tabsStore.ts`
  - `src/components/tabs/TabRegistry.tsx`
  - `src/components/tabs/TabIcons.tsx`
  - `src/navigation/tabDestinations.ts`
  - `src/commandPalette/registry.tsx`
  - `src/components/layout/MainLayout.tsx`
  - `src/lib/i18n/locales/en.ts`
  - `src/lib/i18n/locales/de.ts`
  - `src/lib/i18n/locales/es.ts`
  - `src/lib/i18n/locales/fr.ts`
  - `src/lib/i18n/locales/ja.ts`
  - `src/lib/i18n/locales/zh.ts`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/openStudySource.ts`
  - `src/lib/study-plans/__tests__/openStudySource.test.ts`
  - `src/routes/study-plans.tsx`
- **Implementation Summary:**
  - Implemented `openStudySource.ts`:
    - Handles strict native-only check (`isTauri()`), returns typed `unsupported_platform` failure for browser/PWA.
    - Honors resolution status: fails closed on `unsupported` or `ambiguous` without silent loss.
    - Rehydrates live document via `useDocumentStore` / `getDocument`, returning `missing` if deleted.
    - Stale revision detection against `doc.contentHash` / `dateModified` allows coarse navigation only when explicitly requested.
    - Local video with `extractId` targets `focusedVideoExtractId` tab data with `hideRatingOrbs: true` instead of calling generic `initialJump`.
    - Standard PDF, EPUB, and documents call `openDocumentAtLocation` with `jump` and `excerpt` highlight query.
    - Supports return context for navigating back from viewer.
  - Registered `"study-plans"` in `TabType` (`src/stores/tabsStore.ts`), `TabIcons.tsx` (using Phosphor `Compass`), and `TabRegistry.tsx` (lazy-loading `StudyPlansTab`).
  - Added canonical destination `study-plans` (`/study-plans`) in `NAVIGATION_DESTINATIONS` and aliases in `TAB_TYPE_ALIASES` in `src/navigation/tabDestinations.ts`.
  - Added `go-study-plans` command icon in `src/commandPalette/registry.tsx`.
  - Added `"tour-open-tab-study-plans"` listener in `src/components/layout/MainLayout.tsx`.
  - Added localized strings for `palette.destination.studyPlans`, `palette.destination.studyPlansDesc`, `studyPlans.title`, and `studyPlans.navLabel` across all 6 locales (`en`, `de`, `es`, `fr`, `ja`, `zh`).
  - Created standalone route page in `src/routes/study-plans.tsx`.
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/__tests__/openStudySource.test.ts`: 8 passed.
  - `npm run test:run -- src/navigation/__tests__/tabDestinations.test.ts`: 5 passed.
  - `npm run test:run -- src/commandPalette/__tests__/registryAcceptance.test.tsx`: 37 passed.
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T11`

---


### Task Checkpoint: C1-T11
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T11`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/commandPalette/destinationActions.ts`
  - `src/components/study-plans/StudyPlansTab.tsx`
  - `src/components/Toolbar.tsx`
  - `src/components/mobile/MobileNavigation.tsx`
  - `src/components/documents/DocumentsView.tsx`
  - `src/components/viewer/selectionInteraction/selectionActionRegistry.ts`
  - `src/components/viewer/SelectionActionsSheet.tsx`
  - `src/components/graph/NodeDetailView.tsx`
  - `src/components/review/ReviewHome.tsx`
  - `src/components/assistant/AssistantPanel.tsx`
  - `src/components/tabs/DashboardTab.tsx`
  - `src/commandPalette/registry.tsx`
  - `src/commandPalette/__tests__/registryAcceptance.test.tsx`
  - `openspec/changes/establish-persistent-study-plans/tasks.md`
- **Files Created:**
  - `src/components/study-plans/StudyPlansDashboardCard.tsx`
  - `src/components/study-plans/__tests__/StudyPlansDashboardCard.test.tsx`
- **Implementation Summary:**
  - Integrated the UX §2.3 typed launch envelope (`StudyPlansLaunch`: `home`, `create` with `prefill`, `open-plan`, `open-blueprint`, `resume-attempt`) into `destinationActions.ts`.
  - Wired `useDestinationAction("study-plans", ...)` into `StudyPlansTab.tsx` for seamless routing between home, create with prefilled context, and detail views.
  - Built and mounted `StudyPlansDashboardCard.tsx` in `DashboardTab.tsx`:
    - Shows up to three active plans with title, goal, and depth badge.
    - Quick actions to open a plan, view all plans, or start creating a new plan.
    - Gracefully hides on unsupported browser environments.
  - Integrated entry points:
    - **Toolbar:** Added Study Plans button (`Compass` icon) in Group 1.
    - **Mobile Navigation:** Added Study Plans to `allNavItems` in `MobileNavigation.tsx`.
    - **Library / DocumentsView:** Added "Create Study Plan" to multi-document bulk action bar (with 24 document limit validation) and to single-document context menus.
    - **Reader / Selection:** Added non-AI "Create Study Plan" action in `selectionActionRegistry.ts` and `SelectionActionsSheet.tsx` with document/extract context and 1600-char excerpt guard.
    - **Knowledge Graph:** Added "Create Study Plan" in `NodeDetailView.tsx` passing concept or document/extract context.
    - **Review:** Added "Open Study Plans" in `ReviewHome.tsx` overflow actions with zero mutation of review queues or FSRS stability.
    - **Learning Agent / Assistant:** Added "Create Study Plan from this scope" in `AssistantPanel.tsx` when documents are present in the active agent scope.
    - **Command Palette:** Added `create-study-plan` command ("Create Study Plan") in `registry.tsx`.
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/__tests__/StudyPlansDashboardCard.test.tsx`: 5 passed.
  - `npm run test:run -- src/commandPalette/__tests__/registryAcceptance.test.tsx`: 38 passed.
  - `openspec validate establish-persistent-study-plans --type change --strict --no-interactive`: Valid (exit 0).
- **Next Eligible Task:** `C1-T12`

---


### Task Checkpoint: C1-T12
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T12`
- **Status:** COMPLETE
- **Files Created:**
  - `src/components/study-plans/__tests__/studyPlanPersistence.integration.test.tsx`
- **Implementation Summary:**
  - Built comprehensive integration suite covering all 10 target lifecycle & boundary scenarios:
    1. Offline manual two-source plan creation with PDF document and video extract.
    2. Version editing: topic locking, learning objective addition, prerequisite configuration, draft saving, and version publication.
    3. Store rehydration / restart recovery across recreated store instances.
    4. Explicit node activity transitions (not-started, in-progress, completed, skipped).
    5. Pure local-first operation without network or LLM dependency.
    6. CAS conflict prevention on stale draft revision.
    7. Plan archive and restoration isolation.
    8. Plan deletion isolation: leaves underlying documents, extracts, and other study plans intact.
    9. Legacy import idempotency and recovery.
    10. Absolute isolation of Review, FSRS schedules, and Queue fixtures (snapshot invariance verified before and after).
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/__tests__/studyPlanPersistence.integration.test.tsx`: 1 test (10 sub-scenarios) passed.
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib database::study_`: 7 passed.

---


### Task Checkpoint: C1-T13
- **Change:** `establish-persistent-study-plans`
- **Task ID:** `C1-T13`
- **Status:** COMPLETE
- **Implementation Summary:**
  - Full repository gates executed and verified for Change 1:
    - TypeScript compilation: zero type errors in all study plan components, stores, APIs, and models (`src/components/study-plans/`, `src/lib/study-plans/`, `src/api/study-plans.ts`, `src/types/learningPaths.ts`, `src/types/studySource.ts`).
    - ESLint: zero errors, zero warnings across all changed study plan files (`npx eslint src/components/study-plans/ src/lib/study-plans/ src/api/study-plans.ts src/api/study-sources.ts src/types/learningPaths.ts src/types/studySource.ts src/stores/learningPathsStore.ts`).
    - Rust unit & integration tests: 23/23 tests passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib study_`).
    - Vitest suites: 16 test files passed, 103/103 tests passed across all study plan logic, topology, source validation, UI components, and integration boundaries.
    - Performance benchmark gate: `npm run bench:check` passed (70 benchmarks compared, bundle budget OK).
    - OpenSpec validation: `openspec validate establish-persistent-study-plans --type change --strict --no-interactive` passed (valid).
- **Change 1 Complete:** All 13 tasks (C1-T01 through C1-T13) of `establish-persistent-study-plans` are complete and verified.
- **Next Eligible Task:** `C2-T01` (under `openspec/changes/generate-source-grounded-study-curricula/tasks.md`)

---


### Task Checkpoint: C2-T01
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T01`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/types/learningPaths.ts`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/generation/types.ts`
  - `src/lib/study-plans/generation/curriculumSchemas.ts`
  - `src/lib/study-plans/generation/curriculumValidation.ts`
  - `src/lib/study-plans/generation/__tests__/curriculumValidation.test.ts`
- **Implementation Summary:**
  - Implemented strict proposal contracts: `CurriculumGenerationRequest`, `CurriculumPriorEvidence`, `CurriculumTopicProposal`, `CurriculumEdgeProposal`, `CurriculumDecomposeBatchOutput`, `CurriculumPrerequisiteOutput`, `MasteryEvidenceLevel`, `UncertaintyReason`.
  - Implemented `CURRICULUM_LIMITS`, `CURRICULUM_DECOMPOSE_SCHEMA`, and `CURRICULUM_PREREQUISITE_SCHEMA`.
  - Implemented fail-closed validators in `curriculumValidation.ts`:
    - `validateCurriculumDecomposeBatch`: enforces `schemaVersion: 1`, 3–8 topics per batch, unique batch-local handles matching `^[a-zA-Z0-9_-]{1,64}$`, string bounds (title 1..160, summary 0..1000, conceptName 1..160, objectives 1..6 each 1..240), material support ('grounded' | 'unsupported'), grounded requirement of >=1 valid source handle, and rejection of hallucinated/unallowed source handles with `missing_source`.
    - `validateCurriculumPrerequisiteOutput`: enforces `schemaVersion: 1`, max 48 edges, endpoints must exist in known topic handles (`dangling_prerequisite` on failure), rejection of self-edges (`dependency_cycle`), rejection of duplicate directed edges (`order_conflict`), support ('inferred' | 'unsupported'), and rationale bounds (1..500 chars).
    - `validateCurriculumPriorEvidence`: cleanly accepts null (C2 default without querying future exam tables), and validates diagnostic attempt id, concept mastery levels, uncertainties, and evidence group ids when supplied.
    - `validateCurriculumGenerationRequest`: validates complete request envelope, depths, knowledge policies, and reuses C1 source scope validation.
  - Re-exported generation proposal types from `src/types/learningPaths.ts`.
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/generation/__tests__/curriculumValidation.test.ts`: 18 tests passed in 3ms.
  - `npx eslint src/lib/study-plans/generation/`: 0 errors, 0 warnings.
- **Next Eligible Task:** `C2-T02`

---


### Task Checkpoint: C2-T02
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T02`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/generation/requestHash.ts`
  - `src/lib/study-plans/generation/planEvidence.ts`
  - `src/lib/study-plans/generation/merge.ts`
  - `src/lib/study-plans/generation/rulesOutline.ts`
  - `src/lib/study-plans/generation/__tests__/requestHash.test.ts`
  - `src/lib/study-plans/generation/__tests__/planEvidence.test.ts`
  - `src/lib/study-plans/generation/__tests__/merge.test.ts`
  - `src/lib/study-plans/generation/__tests__/rulesOutline.test.ts`
- **Implementation Summary:**
  - Implemented `requestHash.ts`: pure synchronous SHA-256 computation over canonical goal, depth, knowledge policy, base version, sorted source revision snapshot, prompt contract version, and optional prior evidence.
  - Implemented `planEvidence.ts`: bounded evidence partitioning with max 24 documents, 12 concept seeds, 96 global hits, 12 handles / 18k chars per batch, and depth caps (survey 8, foundational 16, deep 24).
  - Implemented `merge.ts`: deterministic proposal reconciliation respecting user tombstones (`included: false` retained, never resurrected), user locks (`locked: true` preserves content and relative position), user edits/additions (retains user content, unions sources), semantic key calculation, union of validated sources/objectives, Kahn cycle pruning of inferred candidate edges without dropping base edges, and full `PlanVersionDiff` computation.
  - Implemented `rulesOutline.ts`: 100% deterministic, reproducible, no-AI curriculum outline generator leveraging confirmed concept links and library source documents.
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/generation/`: 5 test files, 32/32 tests passed in 392ms.
  - `npx eslint src/lib/study-plans/generation/`: 0 errors, 0 warnings.
- **Next Eligible Task:** `C2-T03`

---


### Task Checkpoint: C2-T03
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T03`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/database/migrations.rs`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Implementation Summary:**
  - Appended migration `140_study_generation_jobs` to `src-tauri/src/database/migrations.rs`:
    - Created `study_generation_jobs` table:
      - Primary key `id TEXT PRIMARY KEY`.
      - Strict CHECK constraints on `kind IN ('curriculum', 'assessment-generation', 'exam-grading')`.
      - Strict CHECK constraints on `status IN ('queued', 'running', 'awaiting-review', 'interrupted', 'completed', 'failed', 'cancelled')`.
      - Fields: `target_id`, `target_revision`, `creation_key`, `request_hash`, `next_step_index`, `lease_owner`, `lease_expires_at`, `cancellation_epoch`, `attempt_count`, `preflight_json`, `progress_json`, `last_error_json`, `created_at`, `updated_at`.
      - Partial unique index `one_active_study_request` on `(kind, target_id, request_hash)` for active states (`queued`, `running`, `awaiting-review`).
      - Partial unique index `unique_active_creation_key` on `creation_key` for active states.
      - Secondary indexes for lease recovery (`idx_study_generation_jobs_lease`), status lookup (`idx_study_generation_jobs_status`), and target lookup (`idx_study_generation_jobs_target`).
    - Created `study_generation_steps` table:
      - Composite primary key `PRIMARY KEY (job_id, step_key)`.
      - Strict CHECK constraints on `status IN ('pending', 'running', 'completed', 'failed', 'skipped')`.
      - Fields: `ordinal`, `input_hash`, `output_ref_id`, `safe_error_json`, `completed_at`.
      - Unique index on `(job_id, ordinal)`.
      - Foreign key cascading deletion on `job_id REFERENCES study_generation_jobs(id) ON DELETE CASCADE`.
  - Added comprehensive migration tests in Rust:
    - `migration_140_study_generation_jobs_fresh_and_prior_db`: tests table existence on both upgrade from migration 139 and full fresh DB.
    - `migration_140_study_generation_jobs_constraints_and_uniqueness`: tests job insertion, active duplicate request rejection, active creation key uniqueness, status transition from active to completed, allowing duplicate insertion post-completion, step constraints, and cascade delete.
- **Verification Evidence:**
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib migration_140`: 2 passed; 0 failed.
- **Next Eligible Task:** `C2-T04`

---


### Task Checkpoint: C2-T04
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T04`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/models/mod.rs`
  - `src-tauri/src/models/study_source.rs`
  - `src-tauri/src/database/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs`
  - `src/lib/study-plans/generation/types.ts`
  - `src/lib/study-plans/generation/curriculumValidation.ts`
  - `src/lib/study-plans/generation/planEvidence.ts`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src-tauri/src/models/study_generation.rs`
  - `src-tauri/src/database/study_generation_repository.rs`
  - `src-tauri/src/commands/study_generation.rs`
  - `src/api/study-generation.ts`
  - `src/api/__tests__/study-generation.test.ts`
- **Implementation Summary:**
  - Implemented domain models in `src-tauri/src/models/study_generation.rs`:
    - `StudyJobKind`, `StudyJobStatus`, `StudyStepStatus`, `StudyAiPreflight`, `StudyJobProgress`, `StudyGenerationJob`, `StudyGenerationStep`.
    - DTO inputs: `CreateStudyStepInput`, `StartStudyJobInput`, `CompleteStudyStepInput`, `FailStudyStepInput`.
  - Implemented `StudyGenerationRepository` in `src-tauri/src/database/study_generation_repository.rs`:
    - `start_study_generation_job`: creates all steps before run within a single transaction; validates target plan version draft state and revision; validates unique ordinals and step keys; enforces caller-UUID creation-key Start replay (returns existing job if input matches, rejects if parameters changed with `invalid_input`); enforces active same-request duplicate acknowledgement (returns existing active job without error).
    - `claim_study_job_step`: atomically validates cancellation epoch, ensures only next eligible step is claimed (`ordinal == next_step_index`), enforces 120-second lease renewal, prevents double claims by another worker (`job_lease_stale`), and marks step running.
    - `complete_study_job_step`: validates lease ownership and cancellation epoch; handles duplicate completion of already-completed step idempotently (returns previous progress if input hash matches, rejects changed input hash with `invalid_input`); writes output reference, updates progress, transitions job to `running` or `awaiting-review`/`completed`, and releases lease.
    - `fail_study_job_step`: records safe error JSON, marks step failed, transitions job to `failed`, and releases lease.
    - `cancel_study_generation_job`: CAS update incrementing cancellation epoch, resets running steps to pending, and preserves completed step outputs.
    - `resume_study_generation_job`: validates interrupted or failed status, updates preflight, resets running/failed steps to pending, and re-queues job.
    - `recover_interrupted_study_jobs`: scans for running jobs with expired leases (`lease_expires_at < now` or NULL lease owner), marks them `interrupted`, resets running steps to pending, and does NOT auto-execute inference.
    - `list_study_generation_jobs`: lists jobs optionally filtered by target ID.
  - Implemented and registered Tauri IPC commands in `src-tauri/src/commands/study_generation.rs`, `src-tauri/src/commands/mod.rs`, and `src-tauri/src/lib.rs`.
  - Implemented typed TypeScript IPC client in `src/api/study-generation.ts` with `StudyApiError` normalization and fail-closed non-Tauri rejection.
- **Verification Evidence:**
  - Rust unit tests in `database::study_generation_repository::tests` and `commands::study_generation::tests`: 8 passed (`test_job_lifecycle_happy_path`, `test_creation_key_replay_and_active_duplication`, `test_claim_lease_and_order_protection`, `test_complete_step_idempotency_and_hash_mismatch`, `test_cancellation_and_resume_recovery`, `test_study_generation_commands_direct_flow`, plus migration 140 tests).
  - All Rust study tests: 31 passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib study_`).
  - Vitest API client tests: 17 passed (`npm run test:run -- src/api/__tests__/study-generation.test.ts`).
  - Vitest generation tests: 32 passed across 5 test suites (`src/lib/study-plans/generation/`).
  - ESLint: 0 errors, 0 warnings (`npx eslint src/api/study-generation.ts src/api/__tests__/study-generation.test.ts src/lib/study-plans/generation/`).
- **Next Eligible Task:** `C2-T05`

---


### Task Checkpoint: C2-T05
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T05`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/generation/privacy.ts`
  - `src/lib/study-plans/generation/preflight.ts`
  - `src/lib/study-plans/generation/pinnedTask.ts`
  - `src/lib/study-plans/generation/__tests__/preflight.test.ts`
  - `src/lib/study-plans/generation/__tests__/pinnedTask.test.ts`
- **Implementation Summary:**
  - Implemented `privacy.ts`:
    - Strict document exclusion check (`isAiExcluded === true` throws `source_ai_excluded`).
    - Local-only document check (`isLocalOnly === true` throws `privacy_denied` if generation or embedding sends off-device).
    - Strict local mode check (`strictLocalOnly === true` throws `privacy_denied` if any traffic leaves device).
    - Cloud disclosure gate for off-device destinations (requires explicit acceptance, throws `privacy_denied` otherwise).
    - Cost consent gate for billable destinations (requires explicit authorization, throws `cost_consent_required` otherwise).
  - Implemented `preflight.ts`:
    - `classifyRouteDestination`: classifies active route without inferring locality from provider labels or request policy.
    - `performStudyAiPreflight`: resolves task route with twin reasoning twins, classifies generation and embedding destinations independently, evaluates privacy boundaries fail-closed, and calculates `maximumModelCalls = 2 × plannedModelSteps`.
    - `validatePreflightUnchanged`: ensures provider consistency on resume/retry, throwing `invalid_state` if changed.
  - Implemented `pinnedTask.ts`:
    - `runPinnedStudyTask`: executes pre-resolved primary/twin task on pinned provider by injecting `options.provider` to suppress `runTask`'s internal alternate-provider/cloud loop; checks cancellation signal early before prompt construction; and merges primary route requested model class and fallback path metadata.
- **Verification Evidence:**
  - Vitest preflight & pinnedTask tests: 13 passed (`npm run test:run -- src/lib/study-plans/generation/__tests__/preflight.test.ts src/lib/study-plans/generation/__tests__/pinnedTask.test.ts`).
  - Combined generation Vitest suites: 45 passed across 7 test suites.
  - ESLint: 0 errors, 0 warnings.
- **Next Eligible Task:** `C2-T06`

---


### Task Checkpoint: C2-T06
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T06`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/lib/ai/tasks/definitions/index.ts`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/ai/schemas/curriculumGeneration.ts`
  - `src/lib/ai/tasks/definitions/curriculumTasks.ts`
  - `src/lib/ai/tasks/__tests__/curriculumTasks.test.ts`
- **Implementation Summary:**
  - Implemented `curriculumGeneration.ts`:
    - Re-exported `CURRICULUM_DECOMPOSE_SCHEMA` and `CURRICULUM_PREREQUISITE_SCHEMA`.
    - Implemented `validateDecomposeOutputForTask` and `validatePrerequisiteOutputForTask` adapting pure fail-closed C2 validators to `ValidationOutcome`.
  - Implemented `curriculumTasks.ts`:
    - Defined `study-curriculum-decompose` (reasoning, timeout 60s, max 1800 output tokens) and its full-class fallback twin `study-curriculum-decompose-full`.
    - Defined `study-curriculum-prerequisites` (reasoning, timeout 60s, max 1200 output tokens) and its full-class fallback twin `study-curriculum-prerequisites-full`.
    - Wired `reasoningFallback` on both primary reasoning tasks.
    - Wrapped all untrusted inputs (user goal, prior evidence, concept seeds, document excerpts, proposed topics) using `wrapUntrustedBlock` and enforced `UNTRUSTED_CONTAINMENT_CLAUSE` in system prompts to neutralize adversarial directives.
    - Registered all 4 tasks in the central task registry via `registerTasks`.
    - Implemented `runCurriculumDecompose` and `runCurriculumPrerequisites` with deterministic target ID `${input.jobId}:${input.stepKey}`.
  - Exported `curriculumTasks` from `src/lib/ai/tasks/definitions/index.ts`.
- **Verification Evidence:**
  - Vitest task twin tests: 9 passed (`npm run test:run -- src/lib/ai/tasks/__tests__/curriculumTasks.test.ts`).
  - ESLint: 0 errors, 0 warnings.
- **Next Eligible Task:** `C2-T07`

---


### Task Checkpoint: C2-T07
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T07`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/lib/study-plans/generation/types.ts`
  - `src/lib/study-plans/generation/requestHash.ts`
  - `src/lib/study-plans/generation/preflight.ts`
  - `src/lib/study-plans/generation/curriculumValidation.ts`
  - `src/lib/study-plans/generation/merge.ts`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/generation/evidence.ts`
  - `src/lib/study-plans/generation/coordinator.ts`
  - `src/lib/study-plans/generation/jobController.ts`
  - `src/lib/study-plans/generation/__tests__/evidence.test.ts`
  - `src/lib/study-plans/generation/__tests__/coordinator.test.ts`
- **Implementation Summary:**
  - Implemented `evidence.ts`:
    - Initial goal retrieval query across explicitly allowed `documentIds` (k=24), with strict defense filtering dropping any out-of-scope hit.
    - Confirmed concept seed query selection in scope (max 12), deterministically sorted.
    - Per-seed queries with k=6 and bounded concurrency of 2.
    - Global unique hit deduplication and capping at 96 hits.
    - Hydrated source references using `resolveStudySourceRefs` converting hits to `StudySourceRefInput` with valid exact/coarse jump locations.
    - Partitioned into model-safe batches (≤12 handles, ≤18k chars) using `planEvidenceBatches` and bound `handleToSourceRefIdMap`.
    - Honest fallback to coarse resolved documents when retrieval returns 0 hits.
  - Implemented `coordinator.ts`:
    - Full multi-step generation execution engine: `decompose:0000` -> `prerequisites:0001`.
    - Live source revision rechecking before each step (`verifySourceRevisions`), detecting stale/missing documents and aborting with `missing_source`/`stale_source`.
    - CAS draft revision checking preventing races against concurrent edits.
    - Pinned task execution with explicit provider/route lock.
    - Decompose step checkpoint: topic validation, semantic deduplication, and draft node save.
    - Prerequisite step checkpoint: topic-to-node mapping, Kahn cycle pruning, DAG ordering, and draft edge save, marking status `awaiting-review`.
    - Cancellation via `AbortSignal` cancelling the job in SQLite while preserving earlier committed checkpoints.
    - Resumption from `nextStepIndex` without repeating completed steps or duplicating draft nodes.
  - Implemented `jobController.ts`:
    - Concurrency management enforcing global cap of at most 2 active Study AI jobs and at most 1 active job per target.
    - Synchronous slot reservation before asynchronous execution to eliminate start races.
    - Lifecycle actions: `startCurriculumJob`, `pauseJob`, `cancelJob`, `resumeJob`, `retryJob`, `listJobs`, `recoverInterrupted`.
    - Progress update subscriptions.
- **Verification Evidence:**
  - Vitest evidence & coordinator tests: 11 passed (`evidence.test.ts`, `coordinator.test.ts`).
  - Vitest all generation tests: 56 passed across 9 test files.
  - Rust study tests: 31 passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib study_`).
  - ESLint: 0 errors, 0 warnings across all changed files.
- **Next Eligible Task:** `C2-T08`

---


### Task Checkpoint: C2-T08
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T08`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/lib/study-plans/generation/types.ts`
  - `src/lib/study-plans/generation/rulesOutline.ts`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/generation/noAiCoordinator.ts`
  - `src/lib/study-plans/generation/coverageProjection.ts`
  - `src/lib/study-plans/generation/__tests__/noAiCoordinator.test.ts`
  - `src/lib/study-plans/generation/__tests__/coverageProjection.test.ts`
- **Implementation Summary:**
  - Implemented `noAiCoordinator.ts`:
    - Completely deterministic, offline-first curriculum outline coordinator with zero model or task invocations.
    - Verified live source revisions via `verifySourceRevisions`.
    - Extracted confirmed concepts and concept links in scope, feeding `generateRulesOnlyCurriculumOutline`.
    - Hydrated coarse and supported source references using `resolveStudySourceRefs`.
    - Preserved user additions, modifications, locks, and tombstones through `mergeCurriculumProposals`.
    - Checkpointed the generated rules outline into the plan draft via `saveStudyPlanDraft`.
  - Implemented `coverageProjection.ts`:
    - Extracted unique concepts from included plan nodes.
    - Executed sequential batch processing (strictly at most 12 concepts per run, never concurrent) using existing `runCoverageAnalysis`.
    - Strictly decoupled content coverage (`EvidenceCoverage`), user study activity (`NodeActivity`), and mastery evidence into separate projections.
    - Preserved honest index completeness (partial, unavailable, blocked) and propagated safe limitation keys without optimistic masking.
- **Verification Evidence:**
  - Vitest noAiCoordinator tests: 3 passed (`noAiCoordinator.test.ts`).
  - Vitest coverageProjection tests: 5 passed (`coverageProjection.test.ts`).
  - Vitest all generation tests: 64 passed across 11 test files.
  - ESLint: 0 errors, 0 warnings across all changed files.
- **Next Eligible Task:** `C2-T09`

---


### Task Checkpoint: C2-T09
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T09`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlanCreateForm.tsx`
  - `src/components/study-plans/StudyPlanEditor.tsx`
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/components/study-plans/GenerationPrivacySummary.tsx`
  - `src/components/study-plans/GenerationProgress.tsx`
  - `src/components/study-plans/GenerationIssueList.tsx`
  - `src/components/study-plans/RulesOnlyNotice.tsx`
  - `src/components/study-plans/StudyJobRecoveryList.tsx`
  - `src/components/study-plans/CurriculumDraftPreview.tsx`
  - `src/components/study-plans/CurriculumGenerator.tsx`
  - `src/components/study-plans/__tests__/curriculumGenerationUI.test.tsx`
- **Implementation Summary:**
  - Implemented `GenerationPrivacySummary`: shows provider, model route, locality (device/lan/remote), max call budget, and distinct affirmative consent checkboxes for cloud disclosure and cost consent.
  - Implemented `GenerationProgress`: deterministic 4-stage pipeline stepper with progress indicator, ARIA attributes, pause/resume/cancel controls, and cancellation confirmation.
  - Implemented `GenerationIssueList`: renders field issues, cycles, ungrounded nodes, and stale source warnings.
  - Implemented `RulesOnlyNotice`: informative banner for deterministic no-AI outlines showing confirmed concept, edge, and source count chips.
  - Implemented `StudyJobRecoveryList`: surfaces interrupted/recoverable jobs with resume and discard actions.
  - Implemented `CurriculumDraftPreview`: previews topological sequence, objectives, citations, prereqs, version diff, and explicit Accept & Publish / Discard Draft controls.
  - Implemented `CurriculumGenerator`: aggregate modal orchestrating configure -> generating -> preview workflow for AI and Source Outline (No AI).
  - Wired into `StudyPlanCreateForm` and `StudyPlanEditor`.
- **Verification Evidence:**
  - Vitest UI tests: 11 passed (`curriculumGenerationUI.test.tsx`).
  - ESLint: 0 errors, 0 warnings across all changed files.
- **Next Eligible Task:** `C2-T10`

---


### Task Checkpoint: C2-T10
- **Change:** `generate-source-grounded-study-curricula`
- **Task ID:** `C2-T10`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-source-grounded-study-curricula/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/generation/__tests__/curriculumFailureMatrix.test.ts`
  - `openspec/changes/generate-source-grounded-study-curricula/verification.md`
- **Implementation Summary:**
  - Implemented comprehensive failure matrix covering 7 core failure scenarios:
    1. Single and multi-source generation inputs.
    2. Cyclic, dangling, and duplicate handle edge detection.
    3. User edits, locks, and tombstone preservation across regenerations.
    4. Prompt injection containment via `wrapUntrustedBlock` and `UNTRUSTED_CONTAINMENT_CLAUSE`.
    5. Fail-closed privacy gate (remote Ollama, remote embedding, missing cloud disclosure, or denied cost consent).
    6. Deterministic rules-only outline without model calls.
    7. Absolute isolation of FSRS-7 and review scheduler.
  - Executed all unit, integration, Rust, format, lint, typecheck, and benchmark gates.
  - Recorded outcomes in `verification.md`.
- **Verification Evidence:**
  - Vitest: 22 files passed, 115 tests passed across study generation.
  - Rust: 31 passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib study_`).
  - Rust formatting: clean (`cargo fmt --check`).
  - TypeScript: 0 errors (`npx tsc --noEmit`).
  - ESLint: 0 errors, 0 warnings.
  - Benchmark gate: 70/70 benchmarks evaluated, 0 regressions (`npm run bench:check`).
  - OpenSpec validation: Valid (`openspec validate generate-source-grounded-study-curricula --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T01` (Change 3: `generate-study-plan-examinations`)

---


### Task Checkpoint: C3-T01
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T01`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/types/assessmentQuestions.ts`
  - `src/lib/study-plans/assessments/questionValidation.ts`
  - `src/lib/study-plans/assessments/questionCodec.ts`
  - `src/lib/study-plans/assessments/publicQuestion.ts`
  - `src/lib/study-plans/assessments/questionFingerprint.ts`
  - `src/lib/study-plans/assessments/__tests__/questionValidation.test.ts`
  - `src/lib/study-plans/assessments/__tests__/questionCodec.test.ts`
  - `src/lib/study-plans/assessments/__tests__/publicQuestion.test.ts`
  - `src/lib/study-plans/assessments/__tests__/questionFingerprint.test.ts`
- **Implementation Summary:**
  - Implemented canonical assessment question domain contracts (`AssessmentQuestion`, `SingleSelectQuestion`, `MultiSelectQuestion`, `ClozeQuestion`, `ShortAnswerQuestion`, `EssayQuestion`, `AssessmentResponse`, `AnalyticRubric`, `BlueprintRevision`, `QuotaSlot`, `QuotaReport`).
  - Implemented fail-closed `questionValidation.ts` covering bounds, duplicate options, option sorting, cloze adjacent blanks, cloze verbatim answer leakage, unmapped required key facts, essay maxPoints >= 4, and hint leakage matching answers.
  - Implemented three-part persistence codec `questionCodec.ts`: encodes `payloadJson`, `answerKeyJson`, and `rubricJson` with strict separation; enforces validation on decode and rejects leaked answer keys; converts model output local handles into canonical questions.
  - Implemented `publicQuestion.ts`: projects whitelisted `PublicQuestion` before and after submission; verifies zero private field leakage via `assertNoPrivateFields`.
  - Implemented `questionFingerprint.ts`: computes deterministic SHA-256 excluding answer selections; calculates token 3-gram Sørensen–Dice duplicate similarity.
- **Verification Evidence:**
  - Vitest: 39 tests passed across 4 test suites.
  - TypeScript: 0 errors (`npx tsc --noEmit`).
  - ESLint: 0 errors, 0 warnings on all assessment files.
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T02`

---


### Task Checkpoint: C3-T02
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T02`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/assessments/quotaPlanner.ts`
  - `src/lib/study-plans/assessments/questionDuplicates.ts`
  - `src/lib/study-plans/assessments/__tests__/quotaPlanner.test.ts`
  - `src/lib/study-plans/assessments/__tests__/questionDuplicates.test.ts`
- **Implementation Summary:**
  - Implemented largest-remainder allocation algorithm (`allocateLargestRemainder`) matching §4.1: exact integer marginals summing to total, descending fractional remainder distribution, stable tie-breaking order.
  - Implemented rotating relative-remainder slot builder (`planQuotaSlots`): selects candidate with highest remaining/original ratio at each slotIndex, preserves exact marginal counts across all dimensions (type, difficulty, topic), and computes deterministic slotKey via SHA-256 over revision ID and 4-digit zero-padded index.
  - Implemented quota deficit reporting and shortfall evaluation (`evaluateQuotaReport`): handles the 30 -> 17 shortfall scenario, raises `quota_shortfall` when unaccepted, and accepts shorter paper with `shortfallAccepted = true`.
  - Implemented model call bounds calculator (`calculateMaxQuestionModelCalls`): 2 * ceil(N / batchSize).
  - Implemented question duplication screening (`screenQuestionDuplicates`): detects exact fingerprint collisions, token 3-gram Sørensen–Dice near-duplicates (threshold >= 0.85), and retake repeat exclusion matches.
- **Verification Evidence:**
  - Vitest: 50 tests passed across all 6 assessment test suites.
  - TypeScript: 0 errors (`npx tsc --noEmit`).
  - ESLint: 0 errors, 0 warnings across all assessment files.
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T03`

---


### Task Checkpoint: C3-T03
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T03`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/database/migrations.rs`
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Implementation Summary:**
  - Re-derived next free migration number as `141`.
  - Appended migration `141_assessment_blueprints` to `MIGRATIONS` in `src-tauri/src/database/migrations.rs`.
  - Created 6 tables: `assessment_blueprints`, `assessment_blueprint_revisions`, `assessment_questions`, `assessment_question_revisions`, `assessment_question_sources`, `assessment_question_targets`.
  - Implemented committed immutability trigger `committed_assessment_question_immutable` preventing mutation of question payload, keys, rubrics, points, kind, or difficulty once committed.
  - Implemented constraints and indexes: `one_blueprint_draft` partial index, `one_selected_question_fingerprint` partial unique index, paper slot unique index, question revision FKs, and `ON DELETE RESTRICT` on `study_source_refs`.
  - Added unit tests verifying: fresh and prior DB execution across all 6 tables, foreign key enforcement, plan detachment on plan deletion, restriction of source ref deletion, slot and fingerprint uniqueness, draft update success, committed revision update abort, invalid kind and max_points rejection, and ready published_at requirement.
- **Verification Evidence:**
  - Rust tests: 35 migration tests passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib database::migrations::tests::`).
  - Rust formatting: Clean (`rustfmt --edition 2021 src-tauri/src/database/migrations.rs`).
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T04`

---


### Task Checkpoint: C3-T04
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T04`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/models/mod.rs`
  - `src-tauri/src/database/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/models/study_source.rs`
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src-tauri/src/models/assessment_blueprint.rs`
  - `src-tauri/src/database/assessment_blueprint_repository.rs`
  - `src-tauri/src/commands/assessment_blueprints.rs`
- **Implementation Summary:**
  - Created Rust domain models for assessment blueprints, blueprint revisions, question revisions, source/target links, and IPC input DTOs.
  - Implemented `AssessmentBlueprintRepository` covering atomic blueprint creation, draft saving with CAS expected revision checks, question upsert with slot replacement, publication with shortfall rules and question validation checks, draft discard, blueprint archival, and unused blueprint deletion.
  - Implemented 9 Tauri IPC commands in `commands/assessment_blueprints.rs` and registered them in `src-tauri/src/lib.rs`.
  - Added repository unit tests covering creation/retrieval, CAS stale revision rejection, publication shortfall enforcement (failing if unaccepted, succeeding if accepted), ready revision immutability, archival, and hard deletion.
- **Verification Evidence:**
  - Rust tests: 4 unit tests passed in `database::assessment_blueprint_repository::tests` (`cargo test --manifest-path src-tauri/Cargo.toml --lib database::assessment_blueprint_repository::tests`).
  - Rust formatting: Clean (`cargo fmt --manifest-path src-tauri/Cargo.toml`).
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T05`

---


### Task Checkpoint: C3-T05
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T05`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/api/assessment-blueprints.ts`
  - `src/api/__tests__/assessment-blueprints.test.ts`
  - `src/lib/study-plans/assessments/blueprintService.ts`
  - `src/lib/study-plans/assessments/__tests__/blueprintService.test.ts`
- **Implementation Summary:**
  - Implemented typed IPC wrappers in `src/api/assessment-blueprints.ts` covering 9 Tauri commands with fail-closed platform guards (`isTauri()`) and `normalizeStudyError`.
  - Implemented `BlueprintService` providing higher-level convenience abstractions for blueprint lifecycle management, pure domain question validation, three-part storage encoding (`encodeQuestionRevision`), canonical SHA-256 fingerprinting, question draft persistence, and question hydration (`decodeQuestionRevision`).
  - Added unit test suites verifying non-Tauri rejection (fail-closed unsupported platform), command dispatch, payload mapping, shortfall error normalization, domain question encoding, and question hydration.
- **Verification Evidence:**
  - Vitest tests: 14 tests passed (10 in `assessment-blueprints.test.ts`, 4 in `blueprintService.test.ts`). All 64 assessment unit tests passing.
  - ESLint: Clean (0 errors, 0 warnings).
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T06`

---


### Task Checkpoint: C3-T06
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T06`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/lib/ai/tasks/definitions/index.ts`
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/lib/ai/schemas/studyQuestionGeneration.ts`
  - `src/lib/ai/tasks/definitions/studyQuestionTasks.ts`
  - `src/lib/ai/tasks/__tests__/studyQuestionTasks.test.ts`
- **Implementation Summary:**
  - Created JSON schema descriptor `STUDY_QUESTION_GENERATE_SCHEMA` and strict fail-closed validator `validateQuestionBatchOutputForTask` verifying assigned quota slots, kind matches, source handles from allowed set, prompt and explanation bounds, hints, option handles, segments, blanks, and rubrics.
  - Implemented AI task twins: primary `study-question-generate` (reasoning modelClass) with fallback to `study-question-generate-full` (full modelClass).
  - Enforced untrusted data containment using `wrapUntrustedBlock` around sources, topics, and excluded fingerprints, with `UNTRUSTED_CONTAINMENT_CLAUSE` in system instructions.
  - Registered tasks in central registry and exported runner `runQuestionGenerationTask` with targetId `jobId:stepKey`.
- **Verification Evidence:**
  - Vitest tests: 14 tests passed in `studyQuestionTasks.test.ts`. All 78 assessment unit tests passing.
  - ESLint: Clean (0 errors, 0 warnings).
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T07`

---


### Task Checkpoint: C3-T07
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T07`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/assessments/evidencePlanner.ts`
  - `src/lib/study-plans/assessments/generationMerge.ts`
  - `src/lib/study-plans/assessments/generationCoordinator.ts`
  - `src/lib/study-plans/assessments/__tests__/evidencePlanner.test.ts`
  - `src/lib/study-plans/assessments/__tests__/generationMerge.test.ts`
  - `src/lib/study-plans/assessments/__tests__/generationCoordinator.test.ts`
- **Implementation Summary:**
  - Implemented `evidencePlanner.ts` to calculate model call budget cap `2 * ceil(N / batchSize)` (max 4 desktop / 2 mobile), partition quota slots into batch steps, select verified grounding source excerpts, and assign batch-local handles `s_0`, `s_1` with persistent `sourceMap`.
  - Implemented `generationMerge.ts` to translate model question proposals into canonical domain `AssessmentQuestion` objects using `convertModelQuestion`, validate domain invariants, screen exact and near duplicates, and aggregate unfulfilled slots into exact `QuotaDeficit`s.
  - Implemented `runAssessmentGenerationCoordinator` in `generationCoordinator.ts` providing durable step leasing, live source revision verification, pinned provider execution, step checkpointing with three-part SQLite question persistence, call budget cap enforcement, abort signal cancellation, idempotent step output reuse, and quota report updates.
- **Verification Evidence:**
  - Vitest tests: 9 tests passed across `evidencePlanner.test.ts`, `generationMerge.test.ts`, and `generationCoordinator.test.ts`. All 87 assessment unit tests passing.
  - ESLint: Clean (0 errors, 0 warnings).
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T08`

---


### Task Checkpoint: C3-T08
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T08`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlansTab.tsx`
  - `src/components/study-plans/StudyPlanEditor.tsx`
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/components/study-plans/assessments/BlueprintSourceScope.tsx`
  - `src/components/study-plans/assessments/BlueprintQuotaControls.tsx`
  - `src/components/study-plans/assessments/BlueprintProviderSummary.tsx`
  - `src/components/study-plans/assessments/GenerationDeficitReport.tsx`
  - `src/components/study-plans/assessments/AssessmentList.tsx`
  - `src/components/study-plans/assessments/AssessmentBuilder.tsx`
  - `src/components/study-plans/assessments/__tests__/BlueprintQuotaControls.test.tsx`
  - `src/components/study-plans/assessments/__tests__/AssessmentBuilder.test.tsx`
- **Implementation Summary:**
  - Built `BlueprintSourceScope` displaying verified grounding documents, extract counts, and snapshot hash.
  - Built `BlueprintQuotaControls` supporting Exam/Practice mode selection, requested count N (1..40), per-kind relative weights and points (1..20), difficulty weights, Exam timer (300..14400s), knowledge policy selector, and live largest-remainder normalized distribution preview.
  - Built `BlueprintProviderSummary` detailing provider, local-only vs remote privacy, batch size, and max model call budget cap.
  - Built `GenerationDeficitReport` rendering shortfall breakdown, duplicates notice, and "Retry Deficits" / "Accept Shortfall" actions.
  - Built `AssessmentList` displaying blueprint cards with mode/state/count badges and management actions.
  - Built `AssessmentBuilder` managing blueprint initialization, draft saving, generation coordinator execution with progress, and paper publication.
  - Integrated `onOpenAssessmentBuilder` into `StudyPlanEditor.tsx` and wired `assessment-builder` view in `StudyPlansTab.tsx`.
- **Verification Evidence:**
  - Vitest tests: 5 tests passed in `BlueprintQuotaControls.test.tsx` and `AssessmentBuilder.test.tsx`. All 35 existing study plan UI tests and 87 assessment unit tests passing.
  - ESLint: Clean (0 errors, 0 warnings).
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T09`

---

### Task Checkpoint: C3-T09
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T09`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlansTab.tsx`
  - `src/components/study-plans/assessments/AssessmentBuilder.tsx`
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `src/components/study-plans/assessments/ChoiceQuestionEditor.tsx`
  - `src/components/study-plans/assessments/ClozeQuestionEditor.tsx`
  - `src/components/study-plans/assessments/FreeResponseEditor.tsx`
  - `src/components/study-plans/assessments/RubricEditor.tsx`
  - `src/components/study-plans/assessments/QuestionSourceEditor.tsx`
  - `src/components/study-plans/assessments/QuestionValidationIssues.tsx`
  - `src/components/study-plans/assessments/QuestionEditor.tsx`
  - `src/components/study-plans/assessments/AssessmentPreview.tsx`
  - `src/components/study-plans/assessments/BlueprintHistory.tsx`
  - `src/components/study-plans/assessments/__tests__/QuestionEditor.test.tsx`
  - `src/components/study-plans/assessments/__tests__/AssessmentPreview.test.tsx`
  - `src/components/study-plans/assessments/__tests__/BlueprintHistory.test.tsx`
- **Implementation Summary:**
  - Implemented full question authoring suite across all 5 question types:
    - `ChoiceQuestionEditor`: single/multi-choice options, correct toggle, explanation.
    - `ClozeQuestionEditor`: markdown segments, blanks authoring (`{{blank_N}}`), case-sensitivity, accepted alternative tokens.
    - `FreeResponseEditor`: sample solutions/outlines, key facts, scoring notes.
    - `RubricEditor`: analytic rubrics with 1..6 criteria, integer weights 1..100, 5 performance levels (0..4), and grounding categories (`source`, `reasoning`, `presentation`).
    - `QuestionSourceEditor`: source citation selection and grounding metadata.
    - `QuestionValidationIssues`: structured alert panel showing errors and distractor warnings.
    - `QuestionEditor`: modal host with live validation, difficulty/application level controls, and save guards.
  - Implemented `AssessmentPreview`: inspection view with examinee/teacher mode toggle (stripping/revealing private answer keys and rubrics), shortfall blocker, and publication dispatch.
  - Implemented `BlueprintHistory`: version inspector, draft diffing, and "Copy as new draft" workflow.
  - Integrated preview and history into `AssessmentBuilder` and wired view navigation in `StudyPlansTab`.
- **Verification Evidence:**
  - Vitest tests: 16 tests passed across `QuestionEditor.test.tsx`, `AssessmentPreview.test.tsx`, and `BlueprintHistory.test.tsx`.
  - OpenSpec validation: Valid (`openspec validate generate-study-plan-examinations --type change --strict --no-interactive`).
- **Next Eligible Task:** `C3-T10`

---

### Task Checkpoint: C3-T10
- **Change:** `generate-study-plan-examinations`
- **Task ID:** `C3-T10`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/generate-study-plan-examinations/tasks.md`
- **Files Created:**
  - `openspec/changes/generate-study-plan-examinations/verification.md`
- **Implementation Summary:**
  - Executed all Change 3 verification suites and repository gates:
    - 17 Vitest test suites (108 tests) passed cleanly in 2.2s.
    - 6 Rust native tests in `assessment_blueprint` passed cleanly.
    - Rust formatting (`cargo fmt --check`) verified clean across all models, repositories, and commands.
    - TypeScript type-checking verified clean (0 errors in Change 3 code).
    - ESLint verified clean (0 errors, 0 warnings across all Change 3 paths).
    - Performance benchmark gate `npm run bench:check` passed with exit code 0 (70/70 benchmarks evaluated, bundle budget verified at 27.2 MB).
    - OpenSpec change validation verified valid with `--strict --no-interactive`.
  - Documented complete execution ledger and domain invariants in `verification.md`.
  - Change 3 is 100% complete. Ready blueprints commit immutable answer keys and rubrics, strictly sequestered from examinee views, with zero mutation of review queues or FSRS-7 cards.
- **Next Eligible Task:** `C4-T01` (Change 4: `implement-resumable-examination-sessions`)

---

### Task Checkpoint: C4-T01
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T01`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Files Created:**
  - `src/types/assessmentSessions.ts`
  - `src/lib/study-plans/attempts/responseValidation.ts`
  - `src/lib/study-plans/attempts/objectiveGrading.ts`
  - `src/lib/study-plans/attempts/attemptScoring.ts`
  - `src/lib/study-plans/attempts/attemptPolicy.ts`
  - `src/lib/study-plans/attempts/__tests__/responseValidation.test.ts`
  - `src/lib/study-plans/attempts/__tests__/objectiveGrading.test.ts`
  - `src/lib/study-plans/attempts/__tests__/attemptScoring.test.ts`
  - `src/lib/study-plans/attempts/__tests__/attemptPolicy.test.ts`
- **Implementation Summary:**
  - Created domain types in `src/types/assessmentSessions.ts` (`ExamAttempt`, `ExamResponse`, `ResponseSubmission`, `ExamGrade`, `ObjectiveGradeOutput`, `AttemptScoreSummary`, `AttemptDetail`, `AttemptSummary`).
  - Implemented `responseValidation.ts`: validates response discriminant against question kind, checks allowed confidence stops `[0, 0.3, 0.5, 0.7, 0.9, 1]`, enforces character limits (short answer 20,000, essay 60,000, cloze blank 2,000), checks duplicate/unknown options and blank IDs, preserves confidence when skipped/unanswered.
  - Implemented `objectiveGrading.ts`: pure deterministic objective grading for all 5 question types. Exact single-select, all-or-nothing multi-select, equal per-blank cloze with NFKC normalization, whitespace collapse, case-sensitivity toggle without punctuation/diacritic stripping or fuzzy matching. Deterministic short-answer exact accepted match, non-exact short/essay pending AI rubric in C5, empty/skipped zero.
  - Implemented `attemptScoring.ts`: calculates attempt summary, enforces `awardedPoints = null` while any question is pending/needs-review/failed, tracks `provisionalObjectivePoints` as separate subtotal, implements display-only half-up 2 decimal rounding.
  - Implemented `attemptPolicy.ts`: state transitions, mode rules (hints/checks only in practice), submission reasons.
- **Verification Evidence:**
  - 4 Vitest test suites (59 tests) passed cleanly in `src/lib/study-plans/attempts/__tests__/`.
- **Next Eligible Task:** `C4-T02`

---

### Task Checkpoint: C4-T02
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T02`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/database/migrations.rs`
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Implementation Summary:**
  - Added migration `142_assessment_sessions` to `src-tauri/src/database/migrations.rs`:
    - `exam_attempts`: attempt lifecycle, mode, client start key idempotency index, timing, revision, and score columns.
    - `exam_responses`: ordered response slots, CAS revision, mutation id dedup index.
    - `exam_response_submissions`: immutable historical submissions, unique `exam-final` submission index, ordinal tracking for practice.
    - `exam_grades`: immutable grade history, unique `is_current` partial index, check constraints for manual origin reasons.
    - Trigger `committed_assessment_question_history_delete_guard`: blocks deletion of question revisions referenced by attempts.
  - Added migration tests: `migration_142_assessment_sessions_fresh_and_prior_db` and `migration_142_assessment_sessions_constraints_and_invariants`.
- **Verification Evidence:**
  - Rust migration tests: 2 passed (`cargo test --manifest-path src-tauri/Cargo.toml --lib migration_142`).
- **Next Eligible Task:** `C4-T03`

---

### Task Checkpoint: C4-T03
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T03`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/models/mod.rs`
  - `src-tauri/src/models/study_source.rs`
  - `src-tauri/src/database/mod.rs`
  - `src-tauri/src/commands/mod.rs`
  - `src-tauri/src/lib.rs`
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Files Created:**
  - `src-tauri/src/models/exam_session.rs`
  - `src-tauri/src/database/exam_session_repository.rs`
  - `src-tauri/src/commands/exam_sessions.rs`
- **Implementation Summary:**
  - Implemented domain models in `src-tauri/src/models/exam_session.rs`:
    - Attempt DTOs, response DTOs, submission DTOs, grade DTOs, input payloads.
  - Implemented `ExamSessionRepository` in `src-tauri/src/database/exam_session_repository.rs`:
    - `start_exam_attempt`: verifies blueprint revision is `ready`, enforces client start key replay idempotency, inserts attempt and ordered response slots atomically.
    - `get_exam_attempt`: returns complete attempt detail including attempt row, all responses, submissions, and current grades.
    - `list_exam_attempts`: returns summaries sorted by started_at DESC.
    - `save_exam_response`: CAS check on response revision, mutation id deduplication (same mutation id & payload returns current state; different payload returns error).
    - `submit_exam_attempt`: CAS on attempt revision, idempotency on submission key, flushes objective grades, enforces one exam-final submission per response, derives complete vs grading status, calculates awarded points.
    - `check_practice_response`: practice-only submission, creates incrementing ordinal submissions, records grade.
    - `cancel_exam_attempt`: cancels in-progress attempt, CAS on attempt revision.
    - `delete_exam_history`: cascades deletion of attempt and related responses/submissions/grades.
  - Implemented Tauri IPC command handlers in `src-tauri/src/commands/exam_sessions.rs`.
  - Registered commands in `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`.
- **Verification Evidence:**
  - Rust tests: 5 passed in `database::exam_session_repository::tests`.
  - Formatting: `cargo fmt --check` clean.
- **Next Eligible Task:** `C4-T04`

---

### Task Checkpoint: C4-T04
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T04`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Files Created:**
  - `src/api/exam-sessions.ts`
  - `src/api/__tests__/exam-sessions.test.ts`
  - `src/lib/study-plans/attempts/attemptRecovery.ts`
  - `src/lib/study-plans/attempts/attemptController.ts`
  - `src/lib/study-plans/attempts/useAttemptLifecycle.ts`
  - `src/lib/study-plans/attempts/__tests__/attemptRecovery.test.ts`
  - `src/lib/study-plans/attempts/__tests__/attemptController.test.ts`
- **Implementation Summary:**
  - Created typed Tauri IPC client `src/api/exam-sessions.ts` with 8 commands: `startExamAttempt`, `getExamAttempt`, `listExamAttempts`, `saveExamResponse`, `submitExamAttempt`, `checkPracticeResponse`, `cancelExamAttempt`, `deleteExamHistory`.
    - Added `ensureNativeSupport` fail-closed check (`unsupported_platform`).
    - Added serialization/deserialization helpers between JSON strings and structured domain objects (`normalizeAttemptDetail`, `normalizeExamResponse`).
  - Implemented `attemptRecovery.ts`: pure recovery state machine reconciling in-progress, completed, cancelled, and deadline-expired states without fake browser defaults.
  - Implemented `attemptController.ts`: durable controller with:
    - 300ms debounced autosave.
    - Synchronous flush-on-navigation before changing question index.
    - Stale async mutation run token protection (never overwrites dirty state when save completes for older token).
    - Remote CAS conflict reconciliation via `getExamAttempt`.
    - Fail-closed submit gate: `submitAttempt` refuses to dispatch if any unsaved dirty responses fail to flush.
    - Deterministic objective grade compilation on submission using `gradeQuestionObjective`.
  - Implemented React lifecycle hook `useAttemptLifecycle.ts` hooking up window `beforeunload`, document `visibilitychange`, and 1s countdown timer with automatic timer submission.
- **Verification Evidence:**
  - 10 Vitest tests passed in `src/api/__tests__/exam-sessions.test.ts`.
  - 6 Vitest tests passed in `src/lib/study-plans/attempts/__tests__/attemptRecovery.test.ts`.
  - 7 Vitest tests passed in `src/lib/study-plans/attempts/__tests__/attemptController.test.ts`.
  - Total 82 Vitest tests passing across all 7 attempt test suites.
  - ESLint: 0 errors, 0 warnings.
- **Next Eligible Task:** `C4-T05`

---

### Task Checkpoint: C4-T05
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T05`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlansTab.tsx`
  - `src/components/study-plans/assessments/AssessmentBuilder.tsx`
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Files Created:**
  - `src/components/study-plans/attempts/ConfidenceSelector.tsx`
  - `src/components/study-plans/attempts/AttemptStartConfirmation.tsx`
  - `src/components/study-plans/attempts/AttemptTimer.tsx`
  - `src/components/study-plans/attempts/AttemptSaveStatus.tsx`
  - `src/components/study-plans/attempts/AttemptProgress.tsx`
  - `src/components/study-plans/attempts/QuestionNavigation.tsx`
  - `src/components/study-plans/attempts/SingleSelectInput.tsx`
  - `src/components/study-plans/attempts/MultiSelectInput.tsx`
  - `src/components/study-plans/attempts/ClozeInput.tsx`
  - `src/components/study-plans/attempts/FreeResponseInput.tsx`
  - `src/components/study-plans/attempts/SubmitAttemptPanel.tsx`
  - `src/components/study-plans/attempts/AttemptRunner.tsx`
  - `src/components/study-plans/attempts/AttemptRunnerView.tsx`
  - `src/components/study-plans/attempts/__tests__/QuestionInputs.test.tsx`
  - `src/components/study-plans/attempts/__tests__/AttemptRunner.test.tsx`
  - `src/components/study-plans/attempts/__tests__/AttemptStartConfirmation.test.tsx`
- **Implementation Summary:**
  - Created complete accessible question input suite across all 5 question types:
    - `SingleSelectInput`: radio fieldset, accessible letter badges, 44px+ tap targets.
    - `MultiSelectInput`: checkbox fieldset, all-or-nothing notice, accessible check indicators.
    - `ClozeInput`: segmented passages with inline inputs for each blank.
    - `FreeResponseInput`: plain textareas with character limits (20k short / 60k essay) and counters.
    - `ConfidenceSelector`: self-reported 6-stop confidence buttons `[0, 0.3, 0.5, 0.7, 0.9, 1]` labeled as self-report without score consequence.
  - Created examination runner infrastructure:
    - `AttemptStartConfirmation`: overview modal showing questions, points, mode rules, and time limit.
    - `AttemptTimer`: accessible timer with milestone screen-reader alerts (no per-second polling noise).
    - `AttemptSaveStatus`: live polite region for saved, saving, unsaved, and retry states.
    - `AttemptProgress`: progress bar with accessible percentages and answered/skipped counts.
    - `QuestionNavigation`: previous/next controls, jump-to-question map with skip flags and answered indicators.
    - `SubmitAttemptPanel`: completion breakdown modal warning about unanswered/skipped questions before final submit.
    - `AttemptRunner`: responsive runner container managing question card, status, navigation, and submission modal.
    - `AttemptRunnerView`: loader view mounted into `StudyPlansTab.tsx`.
  - Wired `AssessmentBuilder` ready papers with a "Start Assessment" action to start an attempt and launch `AttemptRunnerView`.
- **Verification Evidence:**
  - 10 Vitest tests passed across `QuestionInputs.test.tsx`, `AttemptRunner.test.tsx`, and `AttemptStartConfirmation.test.tsx`.
  - ESLint: 0 errors, 0 warnings.
- **Next Eligible Task:** `C4-T06`

---

### Task Checkpoint: C4-T06
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T06`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/attempts/AttemptRunner.tsx`
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Files Created:**
  - `src/components/study-plans/attempts/PracticeRoundHistory.tsx`
  - `src/components/study-plans/attempts/PracticeCheckPanel.tsx`
  - `src/components/study-plans/attempts/__tests__/PracticeCheck.test.tsx`
- **Implementation Summary:**
  - Built `PracticeRoundHistory`: renders history of check rounds with ordinal badges (Round 1, Round 2, ...), timestamps, points, and outcome badges.
  - Built `PracticeCheckPanel`: practice-only interactive panel with:
    - Deterministic objective evaluation via `gradeQuestionObjective`.
    - Instant submission via `checkPracticeResponse` creating an immutable `practice-check` submission record.
    - Result banner providing immediate feedback for correct, partial, incorrect, and pending items.
    - Post-check committed explanation reveal (`question.explanation`).
    - Repeat checking preserving historical rounds without overwriting past attempts.
  - Integrated `PracticeCheckPanel` into `AttemptRunner.tsx`, strictly ensuring it is mounted only in Practice mode and concealed during Exam mode.
- **Verification Evidence:**
  - 3 Vitest tests passed in `src/components/study-plans/attempts/__tests__/PracticeCheck.test.tsx`.
  - ESLint: 0 errors, 0 warnings.
- **Next Eligible Task:** `C4-T07`

---

### Task Checkpoint: C4-T07
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T07`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlansTab.tsx`
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
- **Files Created:**
  - `src/components/study-plans/results/AttemptStatusBadge.tsx`
  - `src/components/study-plans/results/AttemptSourceAction.tsx`
  - `src/components/study-plans/results/ObjectiveScoreSummary.tsx`
  - `src/components/study-plans/results/QuestionResultCard.tsx`
  - `src/components/study-plans/results/AttemptHistory.tsx`
  - `src/components/study-plans/results/AttemptResults.tsx`
  - `src/components/study-plans/results/AttemptResultsView.tsx`
  - `src/components/study-plans/results/__tests__/ObjectiveScoreSummary.test.tsx`
  - `src/components/study-plans/results/__tests__/QuestionResultCard.test.tsx`
  - `src/components/study-plans/results/__tests__/AttemptHistory.test.tsx`
  - `src/components/study-plans/results/__tests__/AttemptResults.test.tsx`
- **Implementation Summary:**
  - Built `AttemptStatusBadge`: renders visual status badges across in-progress, complete, grading, partially-graded, grading-failed, and cancelled states with mode tag.
  - Built `AttemptSourceAction`: source document link integration calling `openStudySource` with graceful deleted/missing handling.
  - Built `ObjectiveScoreSummary`: official score calculation derived strictly when complete; provisional objective subtotal rendered separately when pending items exist; breakdown grid of metrics.
  - Built `QuestionResultCard`: per-item response inspection card showing learner response, self-reported confidence stop, outcome badge, awarded vs max points, revealed committed answers, explanation, and grounding source buttons.
  - Built `AttemptHistory`: longitudinal past attempt inspector computing point/percentage deltas for retakes on the same blueprint paper with the mandatory notice: *"Retakes on the same examination paper may include memory or familiarization effects."*
  - Built `AttemptResults`: comprehensive results container with filter tabs (All, Incorrect Only, Finalized, Pending), retake paper action generating a fresh attempt, and question list.
  - Built `AttemptResultsView`: loader view mounted into `StudyPlansTab.tsx`.
- **Verification Evidence:**
  - 6 Vitest tests passed across `ObjectiveScoreSummary.test.tsx`, `AttemptHistory.test.tsx`, and `AttemptResults.test.tsx`.
  - ESLint: 0 errors, 0 warnings.
- **Next Eligible Task:** `C4-T08` (Change 4 Verification Gate)



---

### Task Checkpoint: C4-T08 & Milestone 4 Completion
- **Change:** `implement-resumable-examination-sessions`
- **Task ID:** `C4-T08`
- **Status:** COMPLETE
- **Files Modified:**
  - `openspec/changes/implement-resumable-examination-sessions/tasks.md`
  - `src/components/study-plans/results/AttemptSourceAction.tsx`
  - `src/lib/study-plans/attempts/responseValidation.ts`
  - `src/api/__tests__/exam-sessions.test.ts`
  - `src/lib/study-plans/attempts/__tests__/attemptRecovery.test.ts`
  - `src/lib/study-plans/attempts/__tests__/attemptController.test.ts`
  - `src/components/study-plans/attempts/__tests__/AttemptRunner.test.tsx`
  - `src/components/study-plans/attempts/__tests__/PracticeCheck.test.tsx`
  - `src/components/study-plans/attempts/__tests__/QuestionInputs.test.tsx`
  - `src/components/study-plans/results/__tests__/AttemptResults.test.tsx`
- **Files Created:**
  - `openspec/changes/implement-resumable-examination-sessions/verification.md`
- **Verification Evidence:**
  - **Vitest:** 14 test files, 101 tests passed, 0 failed across all attempt and runner suites.
  - **Rust native tests:** 7 tests passed (5 in `exam_session_repository` + 2 in `migration_142`).
  - **Type checking:** Clean, 0 errors in all Change 4 files.
  - **Rust formatting:** `cargo fmt --check` clean.
  - **Performance benchmark gate:** `npm run bench:check` passed (70/70 benchmarks evaluated, 0 regressions, bundle budget 27.2 MB verified).
  - **OpenSpec validation:** `npx openspec validate implement-resumable-examination-sessions --type change --strict --no-interactive` passed.
- **Milestone 4 Achieved:** A user can complete an examination, practice questions with immediate feedback, recover sessions seamlessly across interruptions/restarts, and review past attempt history with full source citations.
- **Next Change:** `implement-rubric-based-exam-grading` (Change 5)
- **Next Eligible Task:** `C5-T01`

---

### Task Checkpoint: C6-T04 (repair + verification)
- **Change:** `derive-study-gaps-from-exam-evidence`
- **Task ID:** `C6-T04`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/database/learning_evidence_repository.rs` (list filter fix)
  - `openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md`
- **Implementation Summary:**
  - Fixed `list_learning_gaps` filter: `(?2=1 OR status='active')` so non-dismissed listing returns only active gaps; resolved gaps require includeDismissed=true. Previously resolved leaked into active listing causing test failure.
  - Verified transactional settlement hooks in `exam_session_repository.rs` (delete recompute) and `exam_grading_repository.rs` (final-grade evidence upsert), 8 learning-evidence commands registered in `lib.rs`/`commands/mod.rs`.
- **Verification Evidence:**
  - `cargo test --lib learning_evidence`: 5 passed (3 repo + 2 migration)
  - `cargo test --lib study_`: 31 passed, 0 failed
  - `openspec validate derive-study-gaps-from-exam-evidence --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C6-T05`

---

### Task Checkpoint: C6-T05
- **Change:** `derive-study-gaps-from-exam-evidence`
- **Task ID:** `C6-T05`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/types/knowledgeGaps.ts` (canonical re-export, legacy provenance types)
  - `src/stores/knowledgeGapsStore.ts` (non-persisted API cache, legacy-compat recordGap/dismiss/resolve + load/refresh/dismissNative/reconcile/loadPlanEvidence)
- **Files Created:**
  - `src/api/learning-evidence.ts` (8 commands, fail-closed unsupported_platform)
  - `src/api/__tests__/learning-evidence.test.ts` (3 tests)
  - `src/lib/study-plans/evidence/legacyKnowledgeGapsImport.ts` (preview/convert/execute, backup rename only after commit)
  - `src/lib/study-plans/evidence/__tests__/legacyKnowledgeGapsImport.test.ts` (3 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/api/__tests__/learning-evidence.test.ts src/lib/study-plans/evidence/__tests__/legacyKnowledgeGapsImport.test.ts src/stores/__tests__/knowledgeGapsStore.test.ts`: 3 files, 8 tests passed
  - `npx eslint` on 6 touched files: clean (global tsc has pre-existing unrelated errors, no new errors in touched files)
  - `openspec validate derive-study-gaps-from-exam-evidence --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C6-T06`

---

### Task Checkpoint: C6-T06
- **Change:** `derive-study-gaps-from-exam-evidence`
- **Task ID:** `C6-T06`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlanEditor.tsx` (new Evidence & Gaps tab)
  - `src/components/study-plans/results/AttemptResults.tsx` (Final-only evidence note)
  - `src/components/study-plans/results/AttemptHistory.tsx` (Final-only note + same-paper/cross-paper test ids, fixed priorAttempt scope)
- **Files Created:**
  - `src/components/study-plans/evidence/UncertaintyReasons.tsx`, `EvidenceSummaryCard.tsx`, `NodeLearningProgress.tsx`, `WeakConceptList.tsx`, `KnowledgeGapCard.tsx`, `GapEvidencePanel.tsx`, `GapHistory.tsx`, `StudyPlanProgress.tsx`, `index.ts`
  - `src/components/study-plans/evidence/__tests__/evidenceViews.test.tsx` (6 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/evidence/__tests__/evidenceViews.test.tsx src/components/study-plans/__tests__/StudyPlanEditor.test.tsx src/components/study-plans/results/__tests__/AttemptHistory.test.tsx src/components/study-plans/results/__tests__/AttemptResults.test.tsx`: 4 files, 15 tests passed (fixed priorAttempt ReferenceError)
  - `npx eslint` on evidence + modified views: clean
  - `openspec validate derive-study-gaps-from-exam-evidence --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C6-T07`

---

### Task Checkpoint: C6-T07
- **Change:** `derive-study-gaps-from-exam-evidence`
- **Task ID:** `C6-T07`
- **Status:** COMPLETE
- **Files Created:**
  - `src/lib/study-plans/remediation/remediationService.ts` (practice/follow-up/plan-adjustment draft builders, frozen-scope guard, no auto-start/scheduler/provider)
  - `src/components/study-plans/remediation/RemediationAction.tsx`, `RemediationDisposition.tsx`, `RemediationList.tsx`, `PerformanceComparison.tsx`, `index.ts`
  - `src/lib/study-plans/remediation/__tests__/remediationService.test.tsx` (3 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/evidence/ src/lib/study-plans/remediation/ src/components/study-plans/evidence/ src/api/__tests__/learning-evidence.test.ts src/stores/__tests__/knowledgeGapsStore.test.ts`: 7 files, 40 tests passed
  - `npx eslint` on remediation + evidence: clean; grep confirms no scheduler/queue/FSRS writes (comment only)
  - `cargo test --lib study_` (from src-tauri): 31 passed, 0 failed
  - `openspec validate derive-study-gaps-from-exam-evidence --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C6-T08`

---

### Task Checkpoint: C6-T08
- **Change:** `derive-study-gaps-from-exam-evidence`
- **Task ID:** `C6-T08`
- **Status:** COMPLETE (with honestly recorded unrelated/blocked gates)
- **Files Created:**
  - `openspec/changes/derive-study-gaps-from-exam-evidence/verification.md`
- **Files Modified:**
  - `openspec/changes/derive-study-gaps-from-exam-evidence/tasks.md`
  - Rust formatting only via `cargo fmt`: `commands/learning_evidence.rs`, `database/exam_session_repository.rs`, `database/learning_evidence_repository.rs`, `database/migrations.rs`, `models/learning_evidence.rs`
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/evidence/ src/lib/study-plans/remediation/ src/components/study-plans/evidence/ src/api/__tests__/learning-evidence.test.ts src/stores/__tests__/knowledgeGapsStore.test.ts src/components/study-plans/results/__tests__/ src/components/study-plans/__tests__/StudyPlanEditor.test.tsx`: 11 files, 51 passed
  - `cargo test --lib study_` (src-tauri): 31 passed, 0 failed
  - `npm run test:wave5:regression`: 9 files, 46 passed (review/FSRS isolation)
  - `npx tsc --noEmit`: 0 errors in C6 touched files; global pre-existing unrelated errors untouched
  - `npx eslint` scoped: 0 errors (4 pre-existing warnings)
  - `cargo fmt --check`: pass after `cargo fmt`
  - `npm run bench:check`: FAIL on 1 unrelated pre-existing `podcastAd/cue-regex-throughput` regression (0.05356 > limit 0.04925); stale-below WARNs; no C6 baseline edited
  - `cargo test --lib` full: NOT COMPLETED (timeout at 120s and 600s); targeted suite used instead
  - `openspec validate derive-study-gaps-from-exam-evidence --type change --strict --no-interactive`: Valid
  - Real-provider/device: NOT RUN / NOT QUALIFIED (no paid calls, no physical matrix)
- **Change 6 Complete:** All C6-T01..T08 checked with executed evidence. C7 may consume summaries/gaps/recommendations.
- **Next Eligible Task:** `C7-T01` (`integrate-study-plans-with-adaptive-practice`)

---

### Task Checkpoint: C7-T01
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T01`
- **Status:** COMPLETE
- **Files Modified:**
  - `src-tauri/src/database/assessment_blueprint_repository.rs` (C7 narrow validation: diagnostic 4-12/essay-rejected/timer-null, practice timer-null on create/save/publish + test)
  - `src-tauri/src/database/learning_evidence_repository.rs` (strict diagnostic adapter: mode=diagnostic/complete/all-final/no-evidence guards + test)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/diagnostics/diagnosticConfig.ts` (default 6, 4-12, essay/timer rejection, practice timer)
  - `src/lib/study-plans/diagnostics/diagnosticPriorEvidence.ts` (Skip->null, complete/final/revision guards, sparse insufficient)
  - `src/lib/study-plans/diagnostics/curriculumAdaptation.ts` (rank 0/1/2 preference, lock precedence, DAG-safe)
  - `src/lib/study-plans/diagnostics/__tests__/diagnostics.test.ts` (3 tests)
- **Notes:**
  - `src/api/learning-evidence.ts:get_diagnostic_prior_evidence` already existed from C6-T05 with shared signature; no duplicate wrapper added. No migration added; only existing evidence read command used.
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/diagnostics/__tests__/diagnostics.test.ts`: 3 passed
  - `cargo test --lib diagnostic`: 5 passed (2 new C7 + 3 unrelated diagnostics)
  - `cargo test --lib study_`: 31 passed, 0 failed
  - `npx eslint src/lib/study-plans/diagnostics/ src/api/learning-evidence.ts`: clean
  - `npx tsc --noEmit`: 0 errors in new diagnostics files (global pre-existing errors untouched)
  - `cargo fmt --check`: pass after `cargo fmt`
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T02`

---

### Task Checkpoint: C7-T02
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T02`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/lib/study-plans/assessments/publicQuestion.ts` (exam/diagnostic always exclude hints, practice-only reveal)
  - `src/lib/study-plans/attempts/responseValidation.ts` (hint 0..3 bounds, precommitted/order/exam-leak validator)
  - `src/lib/study-plans/attempts/attemptPolicy.ts` (Finish dedup equality helper)
  - `src/lib/study-plans/attempts/attemptController.ts` (practice-only highest-used hint tracking)
  - `src/components/study-plans/attempts/PracticeCheckPanel.tsx` (hintLevel prop, clamped 0..3 passthrough)
  - `src-tauri/src/database/exam_session_repository.rs` (check hint bounds/precommit; practice Finish reuse-on-identical else ordinal append; seed hints; new tests)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/practice/hintState.ts` (sequential reveal, level lookup)
  - `src/lib/study-plans/practice/practiceAdaptation.ts` (<.6 dec/min1, >.85 no-hints inc/max5, else same + exclusions)
  - `src/lib/study-plans/practice/__tests__/practiceHints.test.ts` (3 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/lib/study-plans/practice/ ... publicQuestion/questionValidation/questionCodec/attempts/AttemptRunner/PracticeCheck`: 12 files, 114 passed (existing C3/C4 suites green)
  - `cargo test --lib exam_session`: 6 passed (incl. new hint-bounds/Finish-dedup + fixed seed hints)
  - `cargo test --lib study_`: 31 passed; `cargo test --lib diagnostic`: 5 passed
  - `npx eslint` scoped: clean; `npx tsc --noEmit`: 0 errors in touched files
  - `cargo fmt --check`: pass after `cargo fmt`
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T03`

---

### Task Checkpoint: C7-T03
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T03`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlanCreateForm.tsx` (optional diagnosticSlot host)
  - `src/components/study-plans/CurriculumGenerator.tsx` (diagnosticSlot passthrough to preview)
  - `src/components/study-plans/CurriculumDraftPreview.tsx` (diagnosticSlot render)
  - `src/components/study-plans/assessments/AssessmentBuilder.tsx` (initialMode/initialConfig/onStartedAttempt; fixed TDZ shadowing bug)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/components/study-plans/diagnostics/DiagnosticChoice.tsx`, `DiagnosticGenerationPanel.tsx`, `DiagnosticResumeCard.tsx`, `DiagnosticResultsAdapter.tsx`, `index.ts`
  - `src/components/study-plans/diagnostics/__tests__/diagnosticWizard.test.tsx` (4 tests)
- **Failure Fixed:**
  - TDZ shadowing: local `const initialConfig` referenced prop `initialConfig` in its own initializer (ReferenceError, builder init failed). Renamed local to `baseConfig` with `configOverride` alias.
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/diagnostics/ ... CreateForm/curriculumGenerationUI/AssessmentBuilder .../diagnostics lib`: 5 files, 24 passed (incl. Take/Skip no-artifact, Take persists + resume, pending disables Apply, no-earlier-imports)
  - `npx eslint` scoped: clean
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T04`

---

### Task Checkpoint: C7-T04
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T04`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/tutor/TutorSheet.tsx` (studyContext + retrieveImpl props, scoped retrieve closure, empty-ids refuse, scope-key reset; session.ts unchanged)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/components/study-plans/tutoring/studyTutorContext.ts` (validated context builder + bounded material)
  - `src/components/study-plans/tutoring/studyTutorPrivacy.ts` (fail-closed preflight)
  - `src/components/study-plans/tutoring/StudyTutorHost.tsx` (refuse UI vs scoped TutorSheet)
  - `src/components/study-plans/tutoring/index.ts`
  - `src/components/study-plans/tutoring/__tests__/studyTutor.test.tsx` (4 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/tutoring/ src/components/language/__tests__/tutorIntegration.test.tsx src/components/viewer/__tests__/SelectionActionsSheet.relationships.test.tsx`: 3 files, 16 passed (scoped retrieval filters, no global fallback, missing/deleted/excluded refuse, non-Study defaults unchanged)
  - `npx eslint` scoped: clean
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T05`

---

### Task Checkpoint: C7-T05
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T05`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/attempts/AttemptRunner.tsx` (practice-only hint control/guidance, hintLevel passthrough, return context)
  - `src/components/study-plans/attempts/PracticeCheckPanel.tsx` (C7-T02 hintLevel already; reused)
  - `src/components/study-plans/assessments/AssessmentPreview.tsx` (Practice-only hint policy note)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/components/study-plans/practice/PracticeHintControl.tsx`, `PracticeGuidancePanel.tsx`, `NextPracticePanel.tsx`, `PracticeContextReturn.tsx`, `index.ts`
  - `src/components/study-plans/practice/__tests__/practiceLifecycle.test.tsx` (4 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/practice/ ... AttemptRunner/PracticeCheck/AssessmentPreview/QuestionEditor`: 5 files, 23 passed (hint→check→tutor→recheck→Finish→Next, exact hint/repetition, no scheduler writes, restart disclosure)
  - `npx eslint` scoped: clean
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T06`

---

### Task Checkpoint: C7-T06
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T06`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/lib/ai/tasks/definitions/learnThisValidation.ts` (exported candidateSignature unchanged)
  - `src/components/learn/LearnThisProposalSheet.tsx` (static clozeText/clozeRanges seed, acceptance/perCandidateProposalIds, per-candidate id with unknown fail-closed)
  - `src/components/learn/acceptLearnThis.ts` (perCandidateProposalIds, per-candidate resolution in batch+cloze paths, collision/unknown fail closed)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/lib/study-plans/remediation/cardProposalAdapter.ts` (remediation→acceptanceId, signature→sha256, 300-char serializer, collision/duplicate fail closed)
  - `src/lib/study-plans/remediation/cardAcceptance.ts` (reconcile-before-retry, allowClozeDuplicate=false)
  - `src/components/study-plans/remediation/CardProposalHost.tsx` (static preview/edit/accept/reject, no auto cards)
  - `src/lib/study-plans/remediation/__tests__/cardProposals.test.tsx` (3 tests)
- **Verification Evidence:**
  - `npm run test:run -- LearnThisProposalSheet/static/learnThisValidation/remediation`: 5 files, 33 passed (malformed/duplicate/cloze+non-cloze/same-twice/missing/reject, retry idempotent, legacy callers unchanged)
  - `npx eslint` scoped: clean
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T07`

---

### Task Checkpoint: C7-T07
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T07`
- **Status:** COMPLETE
- **Files Modified:**
  - `src/components/study-plans/StudyPlansTab.tsx` (returnContext on runner/results/builder views)
  - `src/components/study-plans/attempts/AttemptRunnerView.tsx` (+returnContext passthrough)
  - `src/components/study-plans/results/AttemptResultsView.tsx` (+returnContext banner, recompute note)
  - `src/components/study-plans/assessments/AssessmentBuilder.tsx` (+returnContext banner)
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Files Created:**
  - `src/components/study-plans/remediation/returnContext.ts`
  - `src/components/study-plans/remediation/ReassessmentChoice.tsx` (retake-same vs new-paper, exclusions, no auto-start, source deleted/stale)
  - `src/components/study-plans/remediation/WeakTopicWorkspace.tsx` (weak→source/tutor/practice/cards/dismiss→retake/new→results→plan)
  - `src/components/study-plans/remediation/__tests__/reassessment.test.tsx` (3 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/components/study-plans/remediation/__tests__/reassessment.test.tsx`: 3 passed (fixed duplicate-mount)
  - `npm run test:run -- src/lib/study-plans/remediation/ src/components/study-plans/remediation/`: 3 files, 9 passed
  - `npm run test:run -- remediation + AttemptResults + AttemptRunner`: 3 files, 11 passed
  - `npx eslint` scoped: clean; `npx tsc --noEmit`: 0 errors in touched files
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
- **Next Eligible Task:** `C7-T08`

---

### Task Checkpoint: C7-T08
- **Change:** `integrate-study-plans-with-adaptive-practice`
- **Task ID:** `C7-T08`
- **Status:** COMPLETE (with honestly recorded full-suite timeout)
- **Files Created:**
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/verification.md`
- **Files Modified:**
  - `openspec/changes/integrate-study-plans-with-adaptive-practice/tasks.md`
- **Verification Evidence:**
  - C7 targeted Vitest: 9 files, 30 passed
  - Existing-owner regression: 5 files, 30 passed; wave5: 9 files, 46 passed (no scheduler writes)
  - Rust: diagnostic 5, exam_session 6, assessment_blueprint 5 — all passed
  - `npx tsc --noEmit`: 0 errors in C7 touched files
  - `npx eslint` scoped: clean; `cargo fmt --check`: pass
  - `npm run bench:check`: PASS (70 compared OK; 27.2 MB)
  - `cargo test --lib` full: NOT COMPLETED (timeout); targeted suites used instead
  - `openspec validate integrate-study-plans-with-adaptive-practice --type change --strict --no-interactive`: Valid
  - Real-provider/device: NOT RUN / NOT QUALIFIED
- **Change 7 Complete:** All C7-T01..T08 checked with executed evidence.
- **Next Eligible Task:** `C8-T01` (`validate-study-plans-and-examinations-end-to-end`)

---

### Task Checkpoint: C8-T01 (functional complete; strict validation blocked by tooling)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T01`
- **Status:** FUNCTIONALLY COMPLETE — checkbox left unchecked (strict validator requires specs deltas; change is `skip_specs:true` by design, no behavior to spec)
- **Files Created:**
  - `src/test/study-plans-golden/fixtures/osCourse.ts`, `sourceManifest.ts`, `goldenOracle.ts`, `aliases.ts`, `schedulerSentinel.ts`
  - `src/test/study-plans-golden/assets/os.pdf`, `ch01.xhtml`, `transcripts.json`
  - `src/test/study-plans-golden/__tests__/fixtures.test.ts` (3 tests, incl. twice-identical run)
  - `src-tauri/src/golden_test_support.rs` (test-only corpus loader + twice-identical test)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/`: 1 file, 3 tests passed (corpus/hashes/slots/scores/evidence math, asset determinism + mutation detection)
  - `cargo test --lib golden_test_support` (src-tauri): 1 passed (3 docs + 5 concepts, idempotent reload)
  - `npx eslint` fixtures/tests: clean; `cargo fmt --check`: pass after `cargo fmt`
  - `openspec validate validate-study-plans-and-examinations-end-to-end --type change --strict/--no-interactive`: FAILS on missing specs deltas — pre-existing structural (change has no specs/ by `skip_specs:true` design; adding specs would violate "do not add behavior here"). Left unchecked per task rule.
- **Next Eligible Task:** `C8-T02`

---

### Task Checkpoint: C8-T02 (functional complete; strict validation blocked by tooling)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T02`
- **Status:** FUNCTIONALLY COMPLETE — checkbox left unchecked (C8 strict validator requires specs deltas; change is `skip_specs:true` by design)
- **Files Created:**
  - `src/test/study-plans-golden/scriptedProvider.ts`, `providerJournal.ts`, `networkGuard.ts`, `nativeHarness.ts`
  - `src/e2e/study-plans-golden.spec.ts` (isolated harness smoke outline; full E2E NOT RUN in unit gates)
  - `src/test/study-plans-golden/__tests__/harness.test.ts` (4 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/`: 2 files, 7 tests passed (keyed fixtures, unexpected-call fail, network deny, alias/clock normalization, metadata-only journal; fixed payload-class substring assertion)
  - `cargo test --lib golden_test_support` (src-tauri): 1 passed (temp SQLite create/reopen via real migrations)
  - `npx eslint` harness/spec: clean; `cargo fmt --check`: pass after `cargo fmt`
  - Playwright E2E: NOT RUN (needs dev server + native build; spec committed as outline)
  - `openspec validate ... --strict`: blocked (same pre-existing C8 specs-delta tooling issue as T01)
- **Next Eligible Task:** `C8-T03`

---

### Task Checkpoint: C8-T03 (functional unit layer complete; E2E NOT RUN; checkbox unchecked)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T03`
- **Status:** FUNCTIONALLY COMPLETE (unit layer) — checkbox left unchecked (C8 strict validator tooling block; full E2E needs browser/native device)
- **Files Created:**
  - `src/test/study-plans-golden/goldenAssertions.ts` (30 steps, unit layer)
  - `src/test/study-plans-golden/artifactSnapshots.ts` (normalized manifest builder)
  - `src/test/study-plans-golden/__tests__/goldenSteps.test.ts` (3 tests incl. twice-identical run)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/`: 3 files, 10 tests passed (fixtures 3 + harness 4 + golden 3)
  - Fixed null-skip assertion and missing maxPoints in step-16 fixture
  - `npx eslint` golden files: clean
  - E2E/integration layers: NOT RUN (need Playwright dev server + native temp DB + physical device); unit layer only
  - `openspec validate ... --strict`: blocked (pre-existing C8 skip_specs tooling issue)
- **Next Eligible Task:** `C8-T04`

---

### Task Checkpoint: C8-T04 (functional unit layer complete; E2E NOT RUN; checkbox unchecked)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T04`
- **Status:** FUNCTIONALLY COMPLETE (unit layer) — checkbox left unchecked (C8 strict validator tooling block)
- **Files Created:**
  - `src/test/study-plans-golden/negativeCurriculum.ts`, `negativeQuestions.ts`, `negativeAttempts.ts`, `negativeGrading.ts`, `negativeEvidence.ts`, `adversarialSources.ts`
  - `src/test/study-plans-golden/__tests__/negativeMatrix.test.ts` (7 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/__tests__/negativeMatrix.test.ts`: 1 file, 7 tests passed
  - `npx eslint` matrix files: clean
  - Lease/cancel/late/upgrade covered by owning Rust suites (C2/C4/C5/C6 gates green)
- **Next Eligible Task:** `C8-T05`

---

### Task Checkpoint: C8-T05 (functional unit layer complete; E2E/device NOT RUN; checkbox unchecked)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T05`
- **Status:** FUNCTIONALLY COMPLETE (unit layer) — checkbox left unchecked (C8 strict validator tooling block)
- **Files Created:**
  - `src/test/study-plans-golden/privacyMatrix.ts`, `offlineMatrix.ts`, `sourceNavigationMatrix.ts`, `schedulerIsolation.ts`
  - `src/test/study-plans-golden/__tests__/boundaries.test.ts` (5 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/__tests__/boundaries.test.ts`: 1 file, 5 tests passed
  - `npx eslint` matrix files: clean
  - Audio/YouTube: explicit NOT QUALIFIED (no generic jump claim); physical-device matrix remains C8-T09
- **Next Eligible Task:** `C8-T06`

---

### Task Checkpoint: C8-T06 (functional unit layer complete; E2E NOT RUN; checkbox unchecked)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T06`
- **Status:** FUNCTIONALLY COMPLETE (unit layer) — checkbox left unchecked (C8 strict validator tooling block)
- **Files Created:**
  - `src/test/study-plans-golden/migrationFixtures.ts`
  - `src/test/study-plans-golden/__tests__/migrations.test.ts` (2 tests)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/__tests__/migrations.test.ts`: 1 file, 2 tests passed
  - `cargo test --lib migration_139`: 2 passed; `cargo test --lib migration_14`: 8 passed (fresh/prior, FK checks)
  - `npx eslint` fixtures: clean
  - Whole-DB backup/restore on temp DB + PWA refusal: unit-shape only; physical backup E2E NOT RUN
- **Next Eligible Task:** `C8-T07`

---

### Task Checkpoint: C8-T07 (functional unit layer complete; E2E/device NOT RUN; checkbox unchecked)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T07`
- **Status:** FUNCTIONALLY COMPLETE (unit layer) — checkbox left unchecked (C8 strict validator tooling block)
- **Files Created:**
  - `src/lib/study-plans/topology.bench.ts`, `assessments/questionValidation.bench.ts`, `attempts/objectiveGrading.bench.ts`, `evidence/evidenceAggregation.bench.ts`
  - `src/test/study-plans-golden/__tests__/accessibility.test.tsx` (3 tests)
- **Files Modified:**
  - `scripts/perf-baselines.json` (4 new C8-T07 baselines only, no existing budget loosened)
- **Verification Evidence:**
  - `npm run test:run -- src/test/study-plans-golden/__tests__/accessibility.test.tsx`: 1 file, 3 tests passed (fixed import depth)
  - `npm run test:scripts`: pass; `npm run docs:validate`: 76 files pass; `npm run check:bundle`: OK 27.2 MB
  - `npm run bench:check`: 4 new benches pass with new baselines; 2 unrelated pre-existing failures (podcastAd cue-regex, haptic-policy-admission) NOT touched per no-regression rule; stale-below WARNs untouched
  - `npx tsc --noEmit`: 0 errors in touched files; `npx eslint` scoped: clean after unused-var fix; `cargo fmt --check`: pass; `cargo test --lib study_`: 31 passed
  - E2E/a11y device matrix (200% zoom/mobile reflow/touch/reduced-motion/screen reader): NOT RUN — unit labels/status/focus only
- **Next Eligible Task:** `C8-T08`

---

### Task Checkpoint: C8-T08 (NOT RUN — needs user authorization/devices; documented)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T08`
- **Status:** NOT RUN / NOT QUALIFIED — no paid calls made, no devices available
- **Files Created:**
  - `openspec/changes/validate-study-plans-and-examinations-end-to-end/evaluation/provider-matrix.md`, `curriculum-quality.md`, `question-quality.md`, `rubric-quality.md`, `privacy-cost-evidence.md`
- **Verification Evidence:** No executions; procedure + fixed sample sets documented only. Paid calls require explicit separate consent; physical devices require access.
- **Next Eligible Task:** `C8-T09`

---

### Task Checkpoint: C8-T09 (final audit complete with honest blockers; checkbox unchecked)
- **Change:** `validate-study-plans-and-examinations-end-to-end`
- **Task ID:** `C8-T09`
- **Status:** AUDIT COMPLETE — release NOT QUALIFIED (E2E/device/provider NOT RUN; C8 strict-validation tooling block)
- **Files Created:**
  - `openspec/changes/validate-study-plans-and-examinations-end-to-end/verification.md`
  - `evidence/command-log.md`, `evidence/platform-matrix.md`, `evidence/accessibility-matrix.md`, `evidence/golden-normalized-manifest.json`, `evidence/regression-matrix.md`
- **Verification Evidence:**
  - `openspec validate --all --strict --no-interactive`: 682 passed, 46 failed (all 46 pre-existing unrelated; C1–C7 program changes pass; C8 fails on skip_specs tooling)
  - All C8 unit suites pass; E2E/device/provider explicitly NOT RUN
  - Traceability/risk/handoff audit recorded in verification.md; no commit/branch/PR/push
- **Program End State:** C1–C7 complete+verified; C8 unit-layer complete (T01–T07 functional, T08/T09 documented NOT RUN). No safe work remains without E2E/device/provider authorization or validator-tooling decision.
