# Study Plans and Assessments — UX Specification

**Status:** normative interaction and presentation specification; no implementation is included.  
**Scope:** native desktop and native mobile Study Plans, fixed assessments, attempts, results and remediation. Browser/PWA has an explicit unsupported durable-storage experience, not a second store.

Normative domain fields, transitions and command names come from [02-SHARED-CONTRACTS.md](02-SHARED-CONTRACTS.md). Runtime boundaries come from [01-ARCHITECTURE.md](01-ARCHITECTURE.md), deletion behavior from [04-DATA-AND-MIGRATION-PLAN.md](04-DATA-AND-MIGRATION-PLAN.md), and settled choices from [10-ARCHITECTURAL-DECISIONS.md](10-ARCHITECTURAL-DECISIONS.md). This document specifies how those contracts are exposed; it does not create a second lifecycle or scoring model.

## 1. Experience principles and hard boundaries

1. **Manual work is always a first-class path.** A user can create, source-link, edit, save, publish and reopen a plan without AI (C1). C2 adds a labelled deterministic outline; C3 adds manual question authoring; C4 makes objective papers usable offline.
2. **One destination, not a second Review.** `Study Plans` owns plans, blueprint revisions, attempts and evidence reports. Existing Review remains card/FSRS-centric. No Study Plans control calls `submit_review`, rates a card, changes a due date/stability/Queue priority, or silently converts a question into `learning_items`.
3. **Success follows SQLite.** Saving, publishing, starting, checking, submitting and grading controls enter a pending state and show success only after their typed command commits. Browser defaults, optimistic Zustand state and model output are never presented as durable success.
4. **Three facts remain separate.** Material coverage, study activity and demonstrated evidence have independent labels, values, explanations and empty states. None supplies another's value, and no view combines them into a “mastery” percentage.
5. **A fixed exam is not practice.** Exam/diagnostic papers pin question revisions and committed keys/rubrics before Start, reveal no answers or correctness before final submission, and never replace questions mid-attempt. Practice reveals only after Check and supports repeated checked responses.
6. **Answer hiding is ordinary UI policy, not a security guarantee.** The runner receives only `toPublicQuestion(...)` output. It does not receive or render committed keys, accepted answers, references, expected reasoning, rubric descriptors/weights, precommitted hints or explanations before the reveal policy permits them. Never claim cryptographic secrecy, tamper resistance or protection from a user who can inspect their own device/database.
7. **Evidence is explainable, not falsely authoritative.** Display “weighted observed performance,” evidence weights, independent sessions/days and uncertainty reasons under `evidence-v1`; never describe `observedMean` or model `confidence` as probability of knowing.
8. **Source history is preserved honestly.** Stored excerpts and historical document ids survive deletion. Current/stale/missing/ambiguous/unsupported resolution is visible. Missing navigation does not erase a plan or result, and source deletion alone is not represented as deletion of retained exam text.
9. **AI requires endpoint-aware approval.** Preflight separately discloses generation and embedding destinations, selected excerpts/document ids, answer payloads for grading, maximum model calls and billable status. Cloud disclosure and paid-cost consent are separate; local-only/AI-excluded restrictions cannot be waived by a generic consent checkbox. Retry/resume never silently chooses a cloud or paid fallback.
10. **Native persistence only.** Native Tauri desktop/mobile is supported. Browser/PWA renders an explicit unsupported state and performs no successful-looking write. No IndexedDB fallback, cloud fallback or silent command-default interpretation is allowed.

## 2. Information architecture and navigation

### 2.1 One top-level destination

C1 adds `study-plans` to `TabType` and registers the lazy root `StudyPlansTab` in the existing navigation stack. The in-destination view union is:

```ts
type StudyPlansView =
  | { name: "home"; historyNonce?: number }
  | { name: "create"; launchId: number }
  | { name: "plan"; planId: string; versionId?: string; selectedNodeId?: string;
      panel?: "curriculum" | "sources" | "history" | "evidence" | "assessments" }
  | { name: "blueprint"; blueprintId: string; revisionId?: string; selectedSlotKey?: string }
  | { name: "attempt"; attemptId: string; questionRevisionId?: string }
  | { name: "history"; planId?: string; blueprintId?: string; attemptId?: string };
```

This is feature view state, not domain authority. Persist only durable ids and harmless panel/filter preferences in tab restoration data; do not put selected prose, keys, answers, excerpts or provider details in serialized tabs or the Zustand store. A restored invalid id opens a recoverable Not found panel with **Study Plans home**, not an empty screen. The root never infers an attempt from the current plan head: attempts use their pinned `blueprintRevisionId` and question revision ids.

Primary transitions:

- Home → Create wizard → Plan editor.
- Plan editor → Plan history / Evidence / Assessments / Assessment builder.
- Assessment builder → fixed-paper preview → Start confirmation → Attempt runner.
- Attempt runner → Results on Submit/expiry; leaving before Submit keeps an InProgress attempt.
- Results → item detail / grade history / Evidence / Remediation / Attempt history / Retake / Follow-up draft.
- Any nested view returns to its durable parent with browser/mobile Back. Back does not silently discard an uncommitted editor, cancel a job or submit an attempt.

### 2.2 Component and route ownership

All paths marked **NEW** are implementation paths under the permitted Study Plans feature directory. Existing paths below were verified in the baseline and are integration owners, not places to duplicate feature screens.

| Surface | Component ownership | Change |
|---|---|---|
| Destination root and view switching | **NEW** `src/components/study-plans/StudyPlansTab.tsx`; lazy export in existing `src/components/tabs/TabRegistry.tsx`; navigation dispatch in existing `src/components/layout/MainLayout.tsx` | C1 |
| Navigation labels/types | existing `src/stores/tabsStore.ts`, `src/navigation/tabDestinations.ts`, `src/components/Toolbar.tsx`, `src/components/mobile/MobileNavigation.tsx` | C1 |
| Palette navigation and actions | existing `src/commandPalette/registry.tsx`, `src/commandPalette/destinationActions.ts`, `src/components/search/CommandCenter.tsx` | C1; later actions C3/C4 |
| Capability and native refusal | existing `src/lib/platformCapabilities.ts`, `src/lib/tauri.ts`; **NEW** `src/components/study-plans/StudyPlanStateNotice.tsx` | C1 |
| View cache and launch consumption | existing `src/stores/learningPathsStore.ts` becomes non-persistent API/view cache; root uses `useDestinationAction` | C1 |
| Shared dialogs/buttons | existing `src/components/md3/Button.tsx`, `src/components/md3/Dialog.tsx`, `src/components/common/ConfirmDialog.tsx`, `src/components/common/MobileContextMenuSheet.tsx` | Reuse, starting C1 |
| Source navigation | **NEW** `src/components/study-plans/PlanSourceList.tsx` owns presentation; adapter calls existing `src/utils/openDocumentAtLocation.ts`, `src/utils/openLibrarySource.ts` only where its status/return behavior is sufficient | C1 |
| Safe generated prose | existing `src/components/common/AssistantResponseContent.tsx`; learner text always plain text | C2/C3/C5 |
| Responsive/reduced-motion inputs | existing `src/contexts/PresentationContext.tsx` and existing `src/styles/mobile.css` motion rules | All UI changes |
| Locale copy | existing `src/lib/i18n/locales/en.ts`, `de.ts`, `es.ts`, `fr.ts`, `ja.ts`, `zh.ts`; keys use `studyPlans.*` | Each owning change |

**Browser routing requirement:** navigation to `/study-plans` must reach `StudyPlansUnsupported`; an unavailable-capability fallback must not redirect it to Dashboard before the explanation is visible. Keep destination discovery distinct from native-command readiness. Native command failure or `unsupported_platform` selects the same refusal panel and no workflow continues on browser return values.

### 2.3 Typed launch envelope

Extend the existing destination-action mechanism rather than adding a global DOM event per entry point. C1 owns the initial envelope; later changes extend it without adding top-level destinations:

```ts
type StudyPlansLaunch =
  | { destination: "study-plans"; action: "home" }
  | { destination: "study-plans"; action: "create";
      prefill?: { title?: string; goal?: string; documentIds?: string[];
        extractIds?: string[]; collectionIds?: string[]; tagIds?: string[];
        conceptId?: string; conceptLabel?: string;
        pendingSource?: StudySourceRefInput } }
  | { destination: "study-plans"; action: "open-plan"; planId: string; nodeId?: string }
  | { destination: "study-plans"; action: "open-blueprint"; blueprintId: string }
  | { destination: "study-plans"; action: "resume-attempt"; attemptId: string };
```

Prefill remains transient until Create commits. Collection/tag ids are selection inputs only; Create shows the resolved document snapshot and never claims later membership updates a published plan. An obsolete `launchId`, deleted plan or timed-out action settles the existing destination request with an explanation. Entry-point activation must not itself create a plan, job, attempt, evidence row or AI call.

## 3. Entry-point behavior

| Entry point | Owner and trigger | Result and required limitations |
|---|---|---|
| Main navigation | `src/components/Toolbar.tsx` desktop action; `src/components/mobile/MobileNavigation.tsx` overflow/registered destination; `/study-plans` through `tabDestinations.ts` | Open Home, preserving an existing destination instance where normal tab policy applies. Native unavailable commands and PWA produce the refusal surface, never false content. (C1) |
| Command palette | `src/commandPalette/registry.tsx` supplies **Study Plans**, **Create Study Plan**, later **New assessment** and **Resume assessment**; `CommandCenter.tsx` executes normal commands | Open Home/Create; a scoped create command passes only available ids/context. Native refusal is still reachable. Dynamic resume entries use persisted attempt summaries, not Review due cards. C3/C4 actions are hidden until those views exist. |
| Library | existing `src/components/documents/DocumentsView.tsx` document bulk-action bar and single-document context action call **Create Study Plan** | Use explicit single-document override or current selection, matching existing bulk-action selection rules. Preselect document ids in **NEW** `src/components/study-plans/StudyPlanCreateForm.tsx`. More than 24 resolved documents is refused with a count and **Review selection**, never silently truncated. No Queue priority/suspend/archive action is triggered. (C1) |
| Reader selection/extract | existing `src/components/viewer/SelectionActionsSheet.tsx` adds a non-AI **Create Study Plan** action; existing `src/components/viewer/DocumentViewerWrapper.tsx` / `DocumentViewer.tsx` preserve source context | Create receives document/extract and revision context plus a pending selection ref only after explicit activation. It does not run passage AI. A prose selection over 1,600 Unicode scalar values is not truncated; offer document-only scope or the existing extract workflow. Existing extract action keeps the extract id. (C1; remediation handoff extended C7) |
| Knowledge Graph | existing `src/pages/KnowledgeGraphPage.tsx` dispatches the action; `src/components/graph/NodeDetailView.tsx` exposes it for concepts/documents/extracts; `src/components/graph/NodeDetailPanel.tsx` carries the corresponding document/extract action where rendered | Concept opens Create with canonical `conceptId`/label and related live material when resolvable; document/extract opens its scope. Missing related material produces a manual plan with a disclosed gap. Plan prerequisites are never drawn as accepted graph edges, and no `concept_links` acceptance occurs. (C1/C2) |
| Review | existing `src/components/review/ReviewHome.tsx` has **Open Study Plans** as a secondary navigation action | Open Home without changing the Review session, deck selection, due queue or scheduler. Review Home never hosts exam questions or displays an exam score as FSRS retrievability. (C1) |
| Learning Agent / Assistant | existing `src/components/assistant/AssistantPanel.tsx` exposes **Create Study Plan from this scope** using its actual source scope; existing `src/components/assistant/LearningAgentProposals.tsx` remains proposal review | Handoff opens the wizard; the agent transcript/tool loop does not generate or persist the curriculum or paper. C7 card remediation can open the same existing proposal preview, but only its explicit acceptance saves cards. (Create C1; remediation C7) |
| Tutor | existing `src/components/tutor/TutorSheet.tsx` with runtime input from existing `src/lib/ai/tutor/session.ts` | A session launched with `studyContext` shows **Return to plan**, **Targeted practice** and **Source** actions through the Study Plans host. Retrieval is actually filtered by `documentIds`, not merely a document id in prompt text. Tutor transcript/hints alone are not demonstrated evidence and do not create cards automatically. (C7) |
| Dashboard | existing `src/components/tabs/DashboardTab.tsx` mounts **NEW** `src/components/study-plans/StudyPlansDashboardCard.tsx` | Show up to three persisted resumable plans/jobs and, from C4, attempts. C6 may add active-gap counts. Each row opens its durable id. Loading/error/empty states are independent of Dashboard stats and never block reading/review cards. Dashboard displays summaries; it does not own plan/evidence calculation. (C1/C2/C4/C6) |

## 4. Screen specifications

### 4.1 Study Plans Home, recovery and legacy import

**Ownership**

- **NEW** `src/components/study-plans/StudyPlanList.tsx` owns list/filter/toolbar composition (C1).
- **NEW** `src/components/study-plans/StudyPlanSummaryCard.tsx` owns one plan summary (C1; evidence fields C6).
- **NEW** `src/components/study-plans/StudyJobRecoveryList.tsx` owns interrupted/failed/resumable job rows (C2, reused C3/C5).
- **NEW** `src/components/study-plans/LegacyStudyPlanImport.tsx` owns old-localStorage preview/import status (C1; legacy gaps C6).

**Data dependencies**

`list_study_plans`, `list_assessment_blueprints` (C3), `list_exam_attempts` (C4), `list_study_generation_jobs` and `recover_interrupted_study_jobs` (C2), plus active-gap counts from `list_learning_gaps` (C6). The legacy importer reads only the documented old key and calls `import_legacy_study_plans` with canonical hash. No list item is synthesized from `localStorage` as current authority.

**Composition and actions**

1. Header: **Create Study Plan**, search by plan title/goal, Active/Archived segmented filter, and **Assessment history** from C4. Search is local to already paged/list summaries only if all summaries are loaded; otherwise filter via the defined repository query rather than implying complete results.
2. Plan row: title, goal excerpt, depth, current published version or **Not yet published**, visible draft badge, updated timestamp, missing/stale source count, and separate coverage/activity/evidence summaries only when their projections exist. Row action opens the published head, or the sole draft when `currentVersion=0`.
3. Overflow: **New assessment** (C3), **Resume attempt** if one is InProgress (C4), **Archive/Restore**, and **Delete plan**. Delete confirmation explicitly says versions/nodes/activity are removed; library and exam history remain and blueprint heads become detached.
4. Recovery rows show job kind, target, `completed/total`, status, safe error and **Inspect checkpoints**. Interrupted/failed jobs also show **Resume…**; Resume opens fresh preflight before inference. Cancelled jobs show retained checkpoints, not a running spinner.
5. Legacy import card appears only when the documented key exists and migration marker is absent. Preview shows valid/invalid paths/nodes/counts and concrete issues; valid legacy mastery numbers are labelled **unverified legacy annotations**. **Import accepted items** is idempotent; only confirmed complete commit permits backup/rename of the old key.

**States and transitions**

Loading uses plan-row placeholders and does not display zero counts prematurely. First-use empty state explains “Create a plan manually from your material; AI is optional” with **Create** and **Import legacy plans** only when applicable. Filtered-empty offers **Clear filter**. Query failure preserves any prior rows marked stale, displays safe error and **Retry**, and never replaces them with an empty-state Create action.

Archive hides the row from Active after commit. Delete routes Home only after successful commit; failure keeps selection and reports `storage_failed`/actual error. A superseded destination launch settles and announces cancellation, not a created plan.

### 4.2 Create Study Plan wizard

**Ownership**

- **NEW** `src/components/study-plans/StudyPlanCreateForm.tsx` owns step state and final command (C1/C2/C7).
- **NEW** `src/components/study-plans/SourceScopePicker.tsx` owns document/extract/collection/tag selection and scope limitations (C1).
- **NEW** `src/components/study-plans/GenerationPrivacySummary.tsx` owns AI disclosure/consent presentation, not authorization decisions (C2/C3/C5).
- **NEW** `src/components/study-plans/diagnostics/DiagnosticChoice.tsx` owns the C7 optional branch.

**Data dependencies**

Live document/extract/collection/tag lists through their existing owners; goal validation through the existing session-goal validator; source hydration/hash through `resolve_study_source_refs`; final `create_study_plan`. C2 uses bounded semantic status/preflight and curriculum jobs. C7 loads or creates a diagnostic blueprint/attempt through the normal C3–C5 paths and reads only final settled evidence for the optional draft adapter.

**Phased steps**

| Step | C1 | C2 addition | C7 addition |
|---|---|---|---|
| 1 Goal | Title (1–120), required goal (1–200 after normalization), Survey/Foundational/Deep explanatory radio cards | Same; no model call while typing | Prefill optional diagnostic-derived objective only after explicit Apply |
| 2 Material | Search/select documents, extracts, collections and tags; badges for file kind, AI-excluded, local-only and current/stale/missing resolution | Show index completeness and bounded-retrieval limitations | Same frozen scope is offered to diagnostic |
| 3 Diagnostic | **Absent; no disabled teaser** | **Absent** | **Skip diagnostic** default or **Take a short diagnostic**; explain 4–12 items, default 6, fixed paper and no placement guarantee |
| 4 Creation method | **Create and edit manually** only | Add **Generate source-grounded draft** and **Build deterministic outline**. Rules outline clearly says confirmed concepts/inventory only, no invented inferred edges or rationales | Diagnostic results may inform a new draft only after **Use these results** |
| 5 Review/create | Resolved concrete document/extract counts, revisions where available, title/goal/depth, explicit dynamic-collection snapshot warning | Method, maximum model calls and restrictions; generation starts only after this review and preflight | Diagnostic status and selected omit/apply choice |

**Actions and validation**

- Step navigation uses labelled Back/Continue buttons and a step list clickable only for visited valid steps. Validation refuses overflow rather than silently cutting goal/source text. Continue focuses the first invalid field and shows a linked error summary.
- Scope counters show `documents/24` and `extracts/200`. Empty resolved scope is invalid. AI-excluded sources remain usable for manual work but block an affected AI start with `source_ai_excluded`; the user may revise the AI scope or choose manual/rules as supported by preflight. Local-only/strict-local-only sources reject non-device generation/embedding even if cloud consent is otherwise granted.
- The source list identifies which selected dynamic inputs resolved into the frozen documents. Removing a collection removes only its selection input before freeze; users inspect the resulting concrete list rather than assuming exclusion precedence.
- Reader `pendingSource` is resolved against live text/revision before it appears grounded. Ambiguous/missing/stale selection stays labelled and editable; no chunk id alone creates a source ref.
- **Create plan** calls one atomic create with the current draft and then transitions to Plan editor. Failure keeps all wizard state. Leaving a never-created wizard with content requests confirmation; Back to a previous step does not discard it.
- C2 Generate persists the job/planned steps before inference and opens curriculum generation review. Cancel/close before job start creates no job. No-provider users retain manual Create and, in C2, deterministic outline.
- C7 **Skip** immediately continues without inference, an empty attempt or evidence. **Take diagnostic** follows the ordinary builder/start/runner/results flow and then returns to this wizard with diagnostic attempt id retained. Incomplete/cancelled diagnostic displays **Resume**, **Discard diagnostic choice**, and **Skip**. A completed but unresolved/nonfinal diagnostic cannot be applied as settled evidence. **Use these results** creates a reviewable `diagnostic-adaptation` draft; it never directly publishes a plan.

### 4.3 Curriculum editor and version review

**Ownership**

- **NEW** `src/components/study-plans/StudyPlanEditor.tsx` owns aggregate loading, selected version and Save/Publish orchestration (C1; draft generation C2).
- **NEW** `src/components/study-plans/PlanOutline.tsx` owns the ordered included-node list and accessible move controls (C1).
- **NEW** `src/components/study-plans/PlanNodeEditor.tsx` owns node fields/objectives/activity (C1).
- **NEW** `src/components/study-plans/PrerequisiteEditor.tsx` owns prerequisite list and issues (C1).
- **NEW** `src/components/study-plans/PlanVersionDiff.tsx` owns added/removed/modified/reordered/edge/lock-conflict review (C1).
- **NEW** `src/components/study-plans/CurriculumDraftPreview.tsx` owns job checkpoints/issues and acceptance (C2).
- **NEW** `src/components/study-plans/evidence/NodeLearningProgress.tsx` owns the three separate indicator groups (coverage C2, activity C1, evidence C6).
- **NEW** `src/components/study-plans/PlanVersionHistory.tsx` owns read-only versions and copy-to-new-draft action (C1).

**Data dependencies**

`get_study_plan`, `save_study_plan_draft`, `publish_study_plan_version`, `discard_study_plan_draft`, `set_study_plan_node_activity`, archive/delete and source-resolution commands. C2 uses `start_study_generation_job`, job-list/resume/cancel commands and separate `coverage-v1` output. C6 uses `get_study_plan_evidence` and `get_concept_mastery_summary`.

The displayed editor always names its `versionId`, `baseVersionId`, version number, state and CAS revision. A Published/Superseded version is read-only. **Edit this version** copies it to the one permitted Draft before enabling fields; **Regenerate** likewise targets a new draft based on the accepted head. No control edits published rows in place.

**Layout and node actions**

1. **Plan header:** editable draft title/goal/depth, frozen source-scope summary, version badge, Save state, **Save draft**, **Review & publish**, **New assessment** (C3), **History**, **Evidence** (C6), **Regenerate** (C2).
2. **Ordered curriculum:** one numbered section per included node in deterministic topological sequence. Each section exposes title, summary, objectives count, concept/custom label, source count, prerequisite/dependent counts, lock, user-modified and support labels. On wide screens selecting a section opens the node editor alongside it; on phone it opens a full-width detail page/sheet with Return.
3. **Node fields:** title, summary, one to six objectives with add/remove/reorder, existing-concept selector with **Custom/material-gap topic**, `materialSupport`, `whyHere` and source association list. Unknown concepts never mint an id. Generated `whyHere` is identified as a proposal, not proof.
4. **Source links:** up to eight per node. Add validates a live excerpt/revision/jump; Open invokes the source-navigation adapter. **Find material** opens bounded library/source selection for an unsupported node rather than fabricating a citation. Removed source association affects only the draft after Save.
5. **Prerequisites:** a readable prerequisite → dependent list, support (`user`, `confirmed-concept-link`, `inferred`, `unsupported`), rationale and evidence controls. Add/Remove operate on directed pairs; inferred/confirmed edges require their evidence. Unaccepted plan edges never appear in the global graph.
6. **Activity control:** Not started / In progress / Completed / Skipped explicit user action. Completion may be user-declared, but reading or opening a source does not set it. Skipped/completed does not relax DAG validity or change demonstrated evidence.
7. **Removed topics:** a separate Tombstones group contains `included=false` logical nodes with **Restore**. Tombstones are never assigned a visible sequence number. Regeneration preserves them so removal does not resurrect a topic.

**DAG-independent editing and move behavior**

The DAG is validity authority even though the main presentation is a list; the list never silently becomes a second order authority.

- Add/edit fields locally, then Save validates the **full** draft. Duplicate ids/title semantic collisions, missing objectives/sources for grounded publication, dangling/self/duplicate edges and cycles produce field/edge-linked issues. No partially “sorted” nodes are appended after a cycle.
- Pointer dragging is optional enhancement. Every node also has **Move** buttons/menu. Move mode announces current position and the valid 1-based range derived from command `minPosition`/`maxPosition` (convert the contract's zero-based bounds consistently). **Move earlier**, **Move later**, and **Move to position…** request a validated target.
- An invalid move leaves the list unchanged and shows `order_conflict`: “Use positions X–Y so prerequisites stay first.” A valid move uses prior positions as preference, normalizes contiguous positions and is not Saved until SQLite commits.
- A cycle issue displays the concrete returned node cycle and **Go to edge**. Saving/publishing is blocked until the user removes/changes an offending edge.
- Lock means preserve content and relative position preference in later drafts, not permission to violate the DAG. Regeneration retains lock even when actual position changes. Diff review lists previous/actual position and reason; Publish requires an explicit **I reviewed N lock-position conflicts** acknowledgement in addition to ordinary diff review.

**Three separate indicators**

`PlanStudyIndicators` renders three adjacent but independently headed groups at plan level and in each node detail. At 200% zoom/phone they stack in the same fixed order; they never become three unlabeled colored dots.

| Group | Exact values and provenance | Required empty/limitation behavior |
|---|---|---|
| **Material coverage** | `coverage-v1`: Supported / Partial / Not covered by indexed evidence / Unknown; show evidence kind/limitations and index Complete/Partial/Unavailable. Source support chips remain separate field metadata. | “Not calculated” before calculation. Unknown/retrieval failure is not zero understanding. Remote embedding requires its own preflight; no coverage request starts merely from opening the editor. Coverage results are not promoted to durable mastery or proof that all library text was searched. |
| **Study activity** | `NodeActivity`: Not started / In progress / Completed / Skipped, with updated time and explicit Set activity. Aggregate may count included nodes in each activity without implying learning. | “No activity declared” is valid. Reading/source opens do not fill this in. It consumes no assessment score and produces no demonstrated-performance weight. |
| **Demonstrated evidence** | C6 `MasteryEvidenceLevel`: Insufficient evidence / Needs attention / Developing / Demonstrated consistently. Optional weighted observed performance percentage is labelled exactly that, with independent sessions, distinct UTC days, min/max, latest evidence, evidence weight and uncertainty chips. | Before C6 and for no final grades show “Insufficient evidence”/“No scored assessment” as applicable, not `0% mastery`. Pending/AI needs-review grades do not settle it. AI-graded, hints-used, repetition, recency and conflicts remain visible. |

**Save, generation, diff and publication transitions**

- Editor states are `clean`, `dirty`, `saving`, `save-failed`, `publishing`, `stale` and `read-only`. `storage_failed` keeps dirty content in memory and focuses **Retry save**; no Saved toast appears. `stale_revision` preserves the local draft and offers **Reload persisted draft** or **Inspect/rebase changes**, never silent last-write-wins.
- Save success replaces the draft/revision atomically and announces Saved once. Publish opens the diff even for manual drafts. Diff groups use stable logical node ids, include removed edges and tombstones, and each item focuses the corresponding read-only old/new details.
- C2 generation progress shows actual completed/total steps, current label, safe failure and **Cancel generation**. Checkpoints are inspectable after completed, awaiting-review, failed, interrupted and cancelled states. No synthetic “almost done” progress is invented.
- Cancellation asks “Stop outstanding model work? Completed steps will be kept.” After confirmation the cancellation epoch increments and pending state says **Cancelling** until acknowledged; late results cannot appear as newly saved nodes.
- Resume/retry opens fresh provider/embedding/destination/cost preflight. It does not automatically charge or restart hidden work. `source_changed` blocks mixing that job's old/new evidence; the existing published head remains untouched.
- Accept draft computes a fresh version diff and CAS check. A stale plan head leaves the generated draft inspectable and requires Rebase/reapply locks/tombstones before acceptance. Publication happens only after the explicit Publish action and successful command; Accept preview alone does not advance the head.
- Partial/cancelled checkpoint acceptance is available only if the resulting draft passes full validation and source publication checks. The confirmation states completed/requested steps and visible deficits; no missing topics are invented. A changed-source or unresolved stale/CAS state is not eligible.
- History lists all version ids/numbers/state/createdBy/publishedAt. Published/Superseded details are immutable. **Copy as new draft** provides user rollback without deleting later history or mutating existing blueprint attempts.

### 4.4 Assessment builder and question editor

**Ownership**

- **NEW** `src/components/study-plans/assessments/AssessmentBuilder.tsx` owns blueprint/revision loading and configuration/result composition (C3; mode exposure C4/C7).
- **NEW** `src/components/study-plans/assessments/BlueprintQuotaControls.tsx` together with `BlueprintSourceScope.tsx` own quotas/timer/topic/source controls (C3).
- **NEW** `src/components/study-plans/assessments/AssessmentPreview.tsx` with `QuestionValidationIssues.tsx` owns slot order, validity and deficits (C3).
- **NEW** `src/components/study-plans/assessments/QuestionEditor.tsx` delegates all five discriminated authoring forms to the typed editors in the same new directory (C3).
- **NEW** `src/components/study-plans/assessments/AssessmentPreview.tsx` owns author and learner projections (C3).
- **NEW** `src/components/study-plans/assessments/GenerationDeficitReport.tsx` owns per-cell deficit review/acceptance (C3).

**Data dependencies**

`create_assessment_blueprint`, `save_assessment_blueprint_draft`, `get_assessment_blueprint_revision`, `list_assessment_blueprints`, `upsert_assessment_question_draft`, `publish_assessment_blueprint`, discard/archive/delete commands and source refs. C2's job commands and preflight are reused unchanged for generation. Attempt history supplies selected excluded fingerprints without exposing answers in generation inputs.

**Configuration**

- Title, Plan version or custom frozen source scope, topic targets and weights, length 1–40, nonnegative integer type weights, difficulty weights 1–5 and application/topic mix summary. Per-kind integer maxPoints 1–20 default to single/multi/cloze=1, short=2 and essay=8; scoring policy and any override appear in preview.
- Mode: Exam in C3; Practice added C4; Diagnostic exposed only C7 with 4–12 items/default 6 and only single-select, multi-select, cloze and short-answer slots. Essay is not a diagnostic kind. No diagnostic entry appears in earlier changes.
- Untimed is default. Enabling a timer requires 300–14,400 seconds and warns that wall-clock time continues through suspension/restart. Practice and C7 Diagnostic display **Untimed** and no enable control.
- Knowledge policy explains Source-only vs Source-plus-model-knowledge. The latter permits clearly labelled unsupported prerequisite suggestions only; accepted exam questions still require current verified evidence.
- Review excluded past papers and exact/near-duplicate warnings. Exclusion affects a new paper, never an already pinned attempt.

Changing count/weights/targets/source scope marks the draft Needs Review and recomputes deterministic marginal quotas/slots. **Apply configuration** requires confirmation if valid old slots will become deficits; it never silently substitutes a different kind/topic/difficulty. A stable slot key links each row to its requested properties.

**Generation and preflight**

**Generate questions** first shows selected documents/excerpt count, generation and embedding destinations, off-device payload classes, maximum call count and billable status. Cloud disclosure and cost consent are independent unchecked choices until affirmative. Start is blocked by feature denial, excluded/local-only restriction, non-authorized route or absent provider; no Running job is fabricated. Generate then batches at most four desktop/two mobile slots and checkpoints valid revisions/deficits atomically.

**Add question manually** works without provider/network. Question forms require:

- Common: kind, prompt, difficulty, objectives, one to four source refs, explanation, integer maxPoints and applicationLevel. Zero to three source-grounded hints may be committed for Practice; their order/preview is explicit but Exam/Diagnostic projection omits them.
- Single-select: 2–8 unique options and exactly one correct option id.
- Multi-select: 2–8 options, at least two correct ids and a distractor; visible “All-or-nothing; no partial credit.”
- Cloze: ordered text/blank segments, per-blank accepted alternatives/case sensitivity, exact deletion grounding and equal-per-blank explanation. No fuzzy correctness switch.
- Short answer: accepted exact alternatives, reference answer, linked key facts and 1–8 analytic criteria.
- Essay: expected reasoning and 2–8 weighted criteria with levels 0–4; maxPoints≥4; source/reasoning/presentation grounding is explicit.

Author preview shows keys/reference/rubric with the label **Authoring — committed at publication**. **Learner preview** renders the exact public projection and omits private fields from its data/DOM. Preview does not start an attempt or save a response.

**Preview and publication**

The list stays in stable slot order and displays kind/difficulty/topic, validation Draft/Valid/Invalid, source status, duplicate flag, commit state and deficit. Selecting opens authoring. **Exclude** leaves a visible deficit. **Regenerate slot** reuses the slot key after preflight, cannot duplicate a valid id and preserves the old valid draft until replacement commits.

Ready publication validates all questions, quotas, current sources and committed keys/rubrics in one transaction. Editing Ready opens **Create new draft revision**; old Ready and its attempts remain immutable/history-accessible. Delete is offered only for unused blueprints; otherwise offer Archive.

`GenerationDeficitReport` shows requested, valid and every deficit `{kind,topic,difficulty,count}`. Example copy: **“17 of 30 questions are valid. The paper is not ready.”** Actions are **Retry deficits…**, **Edit/add questions**, and unchecked **Accept 17 of 30 and publish a shorter paper**. The checkbox names live counts, resets after configuration/question changes, and sends `shortfallAccepted=true` only on explicit Publish. Starting still fails closed with `quota_shortfall` unless a shorter Ready revision was actually published.

### 4.5 Start confirmation, exam runner and practice

**Ownership**

- **NEW** `src/components/study-plans/attempts/AttemptStartConfirmation.tsx` owns pre-start facts and Start idempotency key (C4).
- **NEW** `src/components/study-plans/attempts/AttemptRunner.tsx` owns attempt lifecycle, current question and navigation (C4).
- **NEW** `src/components/study-plans/attempts/SingleSelectInput.tsx`, `MultiSelectInput.tsx`, `ClozeInput.tsx` and `FreeResponseInput.tsx` own typed input controls (C4).
- **NEW** `src/components/study-plans/attempts/QuestionNavigation.tsx` owns question positions/marks/save state (C4).
- **NEW** `src/components/study-plans/attempts/AttemptTimer.tsx` owns derived remaining time/expiry presentation (C4).
- **NEW** `src/components/study-plans/attempts/AttemptSaveStatus.tsx` owns per-response persistence labels (C4).

**Data dependencies**

Ready `BlueprintDetail`, `start_exam_attempt`, `get_exam_attempt`, `save_exam_response`, `submit_exam_attempt`, `cancel_exam_attempt`. Responses use response revision/mutation id CAS; Submit uses attempt revision and unique submission key. No runtime provider call is needed for navigation, saving or objective submission.

**Start screen**

Show title, blueprint revision id/number, mode, fixed question count, maximum points, source-scope limitations and retake label if applicable. Summarize scoring: single exact, multi exact-set all-or-nothing, cloze equal-per-blank, short exact-then-rubric/manual, essay analytic rubric/manual, skipped/unanswered zero and no negative marking. State whether AI grading may follow Submit; it must not surprise the user later. If sources are now stale/missing, explain retained excerpts and unavailable/coarse navigation without deleting the Ready paper.

For a timed Exam, display time limit and **The deadline continues while the app is closed or suspended**. Start requires Ready and commits attempt + ordered question revisions + empty responses + deadline atomically. Repeated activation reuses the same client start key; it cannot create two attempts. Only returned public questions enter the runner.

**Runner content**

1. Header: mode, “Question x of y,” current maxPoints, timer if configured and **Save & leave**. A read-only cancelled/submitted header replaces input with **View responses/results**.
2. Navigator: stable question number, Answered/Skipped/Unanswered, current position and Unsaved/Saving/Saved/Save failed. On desktop this is a complementary list; on phone it is an explicit **Questions** bottom sheet, not swipe-only navigation.
3. Response:
   - Single uses a radiogroup; multi uses checkboxes and repeats all-or-nothing; cloze provides one named input per blank with surrounding text in order; short/essay use resizable textareas with a visible label and valid length limits. Every item may offer optional learner confidence at 0/.3/.5/.7/.9/1 as self-report; it is cleared for Unanswered/Skipped and never changes deterministic/rubric points.
   - No response editor handles HTML. Unknown option/blank ids or kind mismatch blocks the payload and preserves text rather than partially saving it.
4. Footer: **Previous**, **Next**, **Skip question** / **Clear skip**, mode-specific **Check response** (Practice only), and **Review & submit**. Previous/Next flush the current editor and do not change attempt status.
5. Exam/Diagnostic have no Hint, correctness, accepted-answer, explanation or reference controls before final submission. Practice may show Hint and, after each committed Check, correctness/explanation/reference allowed by policy; hint level is included in evidence.

**Persistence and marks**

Response edits mark **Unsaved changes** immediately. A 300 ms debounce saves; “Saved” appears only after command acknowledgement, with server `updatedAt`. Blur, question navigation, pagehide, visibility hidden and native suspension trigger a best-effort immediate flush using the latest client mutation id. Save failure keeps the draft visible, announces failure once and exposes **Retry save**; it never claims unacknowledged keystrokes survived.

Answered and Skipped are distinct. Clearing content returns Unanswered unless Skipped is explicitly selected; skipped and unanswered both score zero only upon the relevant committed submission/check. A stale response revision offers comparison/reload while preserving local text for copy; the app does not overwrite the other response silently.

**Mode-specific transitions**

| Mode | Available actions | Reveal/evidence/submission behavior |
|---|---|---|
| Exam | Save, Skip, Navigate, Review & submit, Cancel attempt | No pre-submit feedback. Submit freezes exactly one `exam-final` submission per response and deterministic grades. Objective-only can become Complete; nonblank subjective work enters Grading/PartiallyGraded. Final grades settle evidence in C6. |
| Diagnostic (C7) | Same fixed-paper controls; untimed | No pre-submit feedback; one final submission. Final grades produce `diagnostic-final` evidence. All-blank diagnostic does not advance beyond Insufficient evidence. |
| Practice | Hint if supported, **Check response**, revise and Check again, **Finish practice** | Each Check commits the current response as the next immutable `practice-check` ordinal and returns feedback after commit. It does not finish the attempt. Finish uses final Submit. Hints/repetition/AI grading are weighted and disclosed under evidence-v1. |

Exam Submit opens a review dialog with Answered/Skipped/Unanswered and unresolved-save counts, links to unanswered questions, and **Submit final answers**. It is never triggered by a single-key shortcut. Double-click/repeat while pending is disabled/idempotent; an acknowledged duplicate returns existing results without extra submissions, grades or evidence.

**Timer, exit, cancel and recovery**

Remaining time derives from `deadlineAt`, not accumulated UI intervals. Announce five-minute and one-minute thresholds politely, not every second. At expiry, disable new edits, flush the latest response, show **Submitting confirmed responses due to time limit**, and submit idempotently. If reopening after the deadline, explicitly recover with `timer-recovered`; explain that only last acknowledged responses are included. There is no claim that device-clock manipulation is prevented.

**Save & leave** returns to the plan/home after the flush result: successful leave shows Resume later; failed leave offers **Stay and retry** or **Leave with unconfirmed changes**. Neither Leave choice submits. **Cancel attempt** is a separate lifecycle action explaining “Confirmed responses stay read-only; no final submission occurs, and cancelling does not grade the current draft or create new evidence. Previously committed Practice checks and their evidence remain.” Cancel commits `cancelled`; it is not deletion. Restart/mobile relaunch opens the same attempt, acknowledged revisions and deadline; never create a duplicate because a tab remounted.

### 4.6 Results and rubric/manual review

**Ownership**

- **NEW** `src/components/study-plans/results/AttemptResults.tsx` owns report status, totals and item navigation (C4; rubric panels C5).
- **NEW** `src/components/study-plans/results/QuestionResultCard.tsx` owns response/outcome/explanation/reveal and submission ordinals (C4/C5).
- **NEW** `src/components/study-plans/grading/ManualGradeReview.tsx` owns criteria, provenance, retry and manual correction (C5).
- **NEW** `src/components/study-plans/results/AttemptHistory.tsx` owns paged history/comparison (C4/C6).

**Data dependencies**

`get_exam_attempt`, fixed question revisions/public result projection, `get_response_grade_history`, `record_manual_grade`, grading jobs/preflight for Retry, `get_study_plan_evidence`/`list_learning_gaps` after C6, and `delete_exam_history`.

**Report header**

Display mode, blueprint revision, started/submitted/completed times, submission reason and status (`submitted`, `grading`, `partially-graded`, `complete`, `grading-failed`, `cancelled`). If `awardedPoints` is non-null and all required grades are Final, show points/maxPoints and percentage rounded half-up to two decimals. Otherwise show **Official total unavailable** and exact reason count. A separate provisional sum may be shown only as **Provisional — unresolved items excluded**, never as the official final score.

Each item shows number, kind, outcome (Correct/Partial/Incorrect/Misconception/Unanswered/Skipped), current points when Final, grade origin, state and **Review answer**. Outcome is never represented solely by red/green. Practice detail exposes committed check ordinals and lets users inspect each response without mutating it. Exam/diagnostic retain exactly one final response per item.

**Revealed answer detail and grading**

After the mode permits reveal, show learner response as plain text, committed deterministic key/accepted answers where applicable, explanation/reference/expected reasoning and current source-link statuses. Short/essay display each committed criterion title, weight, selected level 0–4, exact response quotation, rationale, missing concepts and misconception when assessable. `not-assessable` remains explicit with reason. Show formula inputs and application-computed points; never substitute model score, completeness or confidence.

Provenance includes deterministic/AI/manual, provider/model class, actual destination/fallback, validation outcome and timestamp. Copy says model confidence is self-reported provenance, not calibrated certainty and not points. Generated Markdown uses `AssistantResponseContent`; response quotes/source excerpts are text. No `dangerouslySetInnerHTML` is introduced.

Grading states and actions:

- `grading`: show completed/total grading steps and **Cancel grading**; saved answers/results already available remain inspectable.
- `partially-graded`: list Final and Needs review items; official total null.
- `grading-failed`: safe error, completed checkpoints and **Retry grading…**. Retry repeats preflight including submitted answer/reference/rubric off-device disclosure and cost consent, uses the same pinned question/response/rubric and appends a new grade.
- `needs-review`: **Manual review** provides every criterion level control and required reason. Application recomputes points; commit appends a current Manual grade linked by `supersedesGradeId` and preserves the AI row. A later automatic retry cannot silently supersede Manual.
- A contradictory classification, non-reasoning essay fallback or ambiguous answer shows Needs Review, not a guessed official score. Provider absence keeps the answer pending and offers Manual review; it does not mark non-exact prose wrong.
- Final current-grade settlement updates evidence in the same transaction. Correcting a grade adjusts the same evidence contribution and refreshes affected gaps; no duplicate observation or scheduler mutation occurs.

**Next actions**

**Open source**, **Review evidence/gaps** (C6), **Retake same paper**, **New follow-up paper** (C7), **Targeted practice** (C7), and **Delete attempt history**. Retake starts only from explicit confirmation. Same-paper deltas display **Retake performance; memory of questions can affect results**. Different-paper rows are descriptive observed histories, not normalized/equivalent difficulty or causal improvement. Delete warns that responses, grades, derived exam evidence and retained unreferenced exam excerpts will be removed, while documents/extracts/cards remain; success triggers affected summary/gap recompute before the row disappears.

Cancelled InProgress attempts have a read-only response archive and no fabricated final score or new cancellation evidence; any previously committed Practice check history remains visible with its existing grades/evidence. Unsupported/corrupt newer payloads show an Unavailable report preserving the id and upgrade/recovery guidance; they do not delete or reinterpret history.

### 4.7 Plan and assessment history

**Ownership:** **NEW** `src/components/study-plans/PlanVersionHistory.tsx` (C1) and **NEW** `src/components/study-plans/results/AttemptHistory.tsx` (C4; gap/history context C6), opened from Home, plan and results.

**Data/actions**

Attempt history uses `list_exam_attempts` with paged cursor input and filters for plan/blueprint/mode/status as supported by `AttemptHistoryFilter`; filters are reflected in removable chips. Rows show title/revision/mode, started/completed, status, official points or Unavailable, submissionReason and source-missing count. Actions are Open result/responses, Resume InProgress, Retry/manual grading as applicable, Retake ready revision, and permanent Delete with confirmation.

Comparison selection admits final attempts only. Same `blueprintRevisionId` enables same-paper trend with memory warning. Different revisions sit in separate observed-score series with no “improved mastery” annotation. Unresolved totals stay null in tables/charts. Loading more preserves scroll/focus; cursor failure retains existing rows with Retry. No attempts shows **No completed or saved assessments yet** plus Create assessment only where that capability exists; filtered-empty shows Clear filters.

Plan version history shows immutable old/new diffs and Copy as new draft only. It never deletes an attempt by deleting or superseding a plan version.

### 4.8 Evidence, gaps and remediation

**Ownership**

- **NEW** `src/components/study-plans/evidence/EvidenceSummaryCard.tsx` owns concept evidence state/statistics/history links (C6).
- **NEW** `src/components/study-plans/evidence/WeakConceptList.tsx` owns rules, status, dismissal and local refresh (C6).
- **NEW** `src/components/study-plans/remediation/RemediationList.tsx` owns recommendation dispositions and launch payloads (C6/C7).
- **NEW** `src/components/study-plans/remediation/WeakTopicWorkspace.tsx` owns integration of remediation with source/tutor/practice/cards/follow-up/draft UI (C7); it embeds existing `src/components/tutor/TutorSheet.tsx` and `src/components/learn/LearnThisProposalSheet.tsx` rather than recreating them.

**Data dependencies**

`get_study_plan_evidence`, `get_concept_mastery_summary`, `list_learning_gaps`, `dismiss_learning_gap`, `refresh_local_learning_gaps`, `record_remediation_disposition`; validated source refs and `LearningEvidence` rows. C7 launches ordinary blueprint creation/drafts or existing tutor/card proposal interfaces.

**Evidence presentation and refresh**

Evidence summary identifies `evidence-v1` and last computed time. Expanding a concept shows final-grade observations grouped by actual independent attempt/session and UTC day, hint/AI/repetition/recency weights, score range, latest misconceptions and linked response/evidence ids. The UI calls these policy weights, never effective independent sample sizes or calibrated confidence. Review lapses/read/graph facts are separately identified and do not become exam points.

Automatic work is limited to deterministic settlement and affected-concept fold. **Refresh local reading/review/graph gaps** is an explicit local action, runs chunked work without AI, and never interrupts Reading/Review. Its progress/cancel/failure/last-computed state is visible. No background gap watcher or inference begins on opening this panel.

**Gap list**

Each active gap names concept, kind (`Repeated failure`, `Weak prerequisite`, `Missing material`, `Weak transfer`, etc.), deterministic rule id, evidence-linked rationale and remediation. One wrong answer cannot display Repeated Failure. Insufficient/conflicting/stale evidence remains explicit, and Missing material describes source availability rather than user ignorance. Filter Active / Dismissed / Resolved; **Dismiss** persists rule id/evidence cutoff and asks no unnecessary AI confirmation. New qualifying evidence after the cutoff may resurface it; dismissal never deletes evidence.

**Remediation actions and transitions**

| Recommendation | Behavior and completion rule |
|---|---|
| Open source / Review extract | Resolve current ref and navigate with exact reader locator. Current exact is default; stale is labelled before coarse navigation; missing/ambiguous/unsupported shows retained excerpt and reason with navigation disabled as applicable. Disposition becomes Accepted on launch, Completed only through explicit user action/activity adapter, never merely because a reader mounted. |
| Tutor (C7) | Open existing TutorSheet with bounded excerpts/objectives/evidence summary and `sourceDocumentIds`/`studyContext`; injected retrieval closure applies hard document filters. On close return to the same gap without declaring mastery. |
| Targeted practice (C7) | Create a Practice Draft blueprint with topic/objective/fingerprint constraints and open its builder. No attempt auto-starts. Hints and checks follow practice policy. |
| Follow-up exam (C7) | Create a new Exam Draft with near-duplicate exclusions. User config/generates/publishes/starts normally; no adaptive mid-attempt substitution. |
| Card proposals (C7) | Open existing Learn This/agent preview with independently validated static candidates. Only user acceptance invokes ordinary card creation. No exam question row becomes a scheduled card and no FSRS fields are written by Study Plans. |
| Plan adjustment (C7) | Create a new reviewable plan draft and diff, preserving locks/tombstones. Publish is explicit and DAG/source validated. |

Record Accepted/Dismissed/Completed through the disposition command after the relevant committed user action. A launch failure leaves Suggested and explains failure. Dismissed recommendations remain inspectable. A deleted source/concept retains labels/evidence and offers Find material or custom-plan action instead of a broken canonical-concept link.

## 5. Shared source navigation, failure and platform states

### 5.1 Source-link adapter behavior

`StudySourceLinkList` displays document title snapshot, excerpt, revision/capture info, status and navigation quality. Its C1 adapter:

1. Rehydrates/resolves the stored ref; never treats a chunk id as durable provenance.
2. PDF uses page + quote/hint; EPUB uses validated CFI/range + quote; HTML/Markdown re-resolves quote/offsets; YouTube/audio use seconds/segment.
3. Local video with `extractId` opens `src/components/viewer/DocumentViewerWrapper.tsx` / `DocumentViewer.tsx` tab data using `focusedVideoExtractId`, not generic `initialJump`. Extract navigation may use `focusedExtractId`; other exact jumps use `openDocumentAtLocation` and `chunkLocationToSearchHit` from `src/utils/openLibrarySource.ts`.
4. Returns an explicit outcome to the initiating surface. It must not use `openLibrarySource`'s best-effort silent catch where the user needs a Missing/Stale/Unsupported explanation.
5. Missing/ambiguous disables Open and retains excerpt with Find replacement material; stale permits only labelled coarse navigation when resolution supports it; unsupported tells the user this source kind cannot be jumped to, without calling the plan unreadable.

### 5.2 State matrix

Every async surface has Loading, Ready/Content, Empty where meaningful, Failed and Cancelled/Inactive semantics. Pending controls expose `aria-disabled`/disabled and retain one idempotency key; disabling is not the only indication of progress.

| Condition | Visible behavior | Allowed recovery and forbidden behavior |
|---|---|---|
| No provider configured | Explain on the AI action; manual plan/question editing, rules outline (C2), existing papers, objective taking, history and source navigation remain normal | Open provider Settings or continue manual. No Running job and no fabricated generated item. |
| Provider lacks capability / timeout / malformed output | Current step Failed with safe code/label; committed checkpoints stay inspectable | Retry same step after preflight, manual edit, or choose another explicitly authorized provider. No silent cloud fallback or loosened validator. |
| Offline | Locally persisted plans/papers/responses/results open normally; network-only action says Offline/provider unreachable | Retry when online or use local provider/manual action. Never require inference for navigation/objective submit. |
| Privacy denied / AI-excluded / local-only | Name blocked class/count and exact generation or embedding route | Revise scope/route where policy allows or continue manual. Consent cannot override AI exclusion or local-only prohibition. |
| Cost consent required | Show maximum calls/billable status before Start/Resume/Retry | Separate affirmative paid consent; no prechecked or remembered hidden auto-resume. |
| Loading | Preserve prior content with small Updating indicator, or structural placeholders on first load; actual determinate job counts where available | Cancel where supported. Do not turn slow load into Empty or Saved. |
| Empty | Different first-use, no-evidence, no-gap, filtered-empty and no-selection copy/action | Never render zeros for unloaded/failed projections. |
| Storage write failure | **Not saved**/`storage_failed`, retain dirty editor/response in memory and command inputs | Retry using same safe idempotency/mutation identity as appropriate. Never navigate away claiming success. |
| Stale CAS revision | Show expected/actual and preserve local work | Inspect persisted changes/rebase/copy where domain allows; no blind overwrite. |
| Job/application restart | Running/Queued stale work becomes Interrupted; retained steps listed | Explicit Resume after preflight; no automatic inference or paid retry. |
| Job cancelled | Status Cancelled, completed/requested steps visible | Inspect valid checkpoints, Resume only through supported resume contract and fresh preflight; late output is rejected. |
| Attempt cancelled | Read-only confirmed response history; no final total and no new evidence from cancellation; previously committed Practice checks retain their existing grades/evidence | Return Home/history or permanently delete explicitly; no Undo masquerading as a new attempt with copied answers. |
| Quota shortfall | Needs Review and per-cell deficits | Retry/edit or explicit exact-count acceptance then publish. Never imply requested count was delivered. |
| Unsupported browser/PWA | `StudyPlansUnsupported`: “Study Plans needs the native app's SQLite store. This browser cannot create, edit, take or save assessments here.” Offer Open library / Learn about native versions | No Write/Start/Resume/Import commands, no browser-null success, no IndexedDB/cloud fallback. Normal Library remains usable. |
| Unsupported schema version/corrupt payload | Artifact Unavailable with stable id, version reason and recovery guidance; other artifacts stay usable | Open supported older history where available or upgrade; never erase/reinterpret as empty. |
| Source changed/missing/ambiguous | Current authored/published snapshot remains labelled; stale/missing counts and per-ref reasons visible | Review new scope for new draft; View retained excerpt; Find material. No silent ref substitution or result deletion. |
| Plan deleted / detached blueprint | Assessment history says Plan detached/deleted and retains fixed paper/results | Open paper/history or create unrelated plan; do not reconstruct deleted goal/nodes. |
| Deleted concept | Historical conceptLabel/objectives/evidence remain | Source/custom-plan remediation; no new canonical-concept action for deleted id. |
| Mobile suspension/offline return | Last acknowledged response and deadline restored; interrupted AI work requires consent-aware Resume | Retry unsaved visible text if process survived; after process loss disclose that unacknowledged edits may be absent. No duplicate attempt. |
| Unexpected internal error | Safe `messageKey`, artifact context id and Retry/Home; no source/answer raw text in diagnostics | Preserve durable data; offer reload and explicit export only through supported diagnostics with redaction. |

## 6. Keyboard, responsive, mobile, accessibility and motion

### 6.1 Keyboard and focus

- All functionality uses native buttons, links, inputs, `fieldset`/`legend`, radio/checkbox groups and labelled textareas. No drag, hover, swipe, long-press or color-only action is required.
- Tab order follows chronological/list order. On view changes focus the new `h1`; on Close return focus to the invoking control or nearest surviving row. Dialogs use existing `useDialogFocus` behavior, trap focus, close on Escape when cancellation is safe and restore focus.
- Editor **Move** menu exposes every valid movement without keyboard dragging. Optional Alt+ArrowUp/Alt+ArrowDown may request earlier/later only when the curriculum move handle has focus; ordinary Arrow keys never reorder and text inputs never consume global navigation shortcuts.
- Ctrl/Cmd+S in Plan/Blueprint editor requests the same validated Save as the button and prevents browser Save only in that native active view. In an attempt it requests a response flush, never Submit. These bindings suspend in nested dialogs and are documented in accessible Help.
- Enter/Space activate focused controls; no single-letter question shortcut fires from an input/textarea/contenteditable. Final Submit, Cancel attempt, Delete history, Accept shortfall and Publish draft require their labelled controls/confirmations, not an implicit Enter shortcut.
- Inline validation links focus the offending field/edge. On Save/Submit server failure focus the error summary without destroying the user's current response.

### 6.2 Responsive rules

Use `PresentationContext.mode`/pointer rather than user-agent checks:

- Wide desktop: plan sequence + node detail may be two resizable logical regions; assessment preview list + editor likewise. Either region remains reachable when the other is collapsed and DOM order matches visual order.
- Tablet/narrow desktop: one primary region with a labelled Details drawer; quota/source tables become grouped definition lists rather than requiring horizontal page scrolling.
- Phone: one column, full-width wizard/results/runner, **Questions**/sources/filters in `MobileContextMenuSheet`, sticky primary actions above safe-area and virtual keyboard. Practice feedback appears inline without obscuring the response editor.
- All interactive targets are at least 44×44 CSS px even though older shared buttons may have smaller defaults. Provide visible text labels for unfamiliar icons and accessible names for icon-only overflow/close controls.
- Reflow at 320 CSS px and support 200% text zoom without clipped goal/answers/timer/actions. Long titles/options break safely; response/source/raw ids do not force horizontal scrolling. No essential table requires hover.

### 6.3 Mobile lifecycle and native Back

Native Back closes nested sheet/dialog first, then returns to parent view. In Create/editor it checks dirty state; in an InProgress attempt it opens Save & leave choices rather than silently Submit/Cancel. Suspension immediately requests flush of the latest response and aborts process inference as recoverable. Resume re-reads attempt/job state rather than trusting stale component state. Timed exams continue by durable deadline, and the Start disclosure states this before the attempt begins.

Orientation, desktop/mobile remount and split-pane changes retain ids/current selection but rehydrate from SQLite where necessary. Pending response mutation/submission keys survive view changes within the attempt coordinator. Touch gestures are never the only way to open Questions, reorder nodes, view evidence or submit.

### 6.4 Screen reader, contrast and reduced motion

- One `h1` per feature view and logical headings for plan/version/question. Use `aria-current` for current step/question and `aria-describedby` for scoring/source/save help.
- Save status uses a polite live region only on state transitions (Saving/Saved/Failed), not each keystroke. Timer announcements are threshold-based. Submission failure/error summaries use assertive announcement once, then remain visible.
- Outcome, lock, source state and evidence level pair text/icon/shape with color. Ordinary text meets 4.5:1, large text 3:1, and controls/focus/meaningful graphics 3:1 against adjacent colors. Focus is not removed in high-contrast/e-ink themes.
- `prefers-reduced-motion`, application animations-disabled and e-ink resolve through `PresentationContext.reducedMotion`/existing presentation settings. Disable drawer/question transitions, diff flashes, progress shimmer, auto-scroll animation and celebratory motion. State changes remain instant and visible. Never require animation to understand a moved node or grading completion.
- Final results contain no auto-playing audio/confetti. Source video/audio opens use existing user-controlled playback policy.

## 7. Change/task ownership and testable acceptance checks

The following are the UX work packages to place in the corresponding change tasks. “Owner” includes verification; later changes may compose earlier components but may not bypass their contracts.

### C1 — `establish-persistent-study-plans`

**Tasks:** C1-UX1 destination/typed launches/PWA refusal; C1-UX2 Home/import/wizard; C1-UX3 DAG editor/sources/versions; C1-UX4 library/reader/graph/Review/Assistant/Dashboard entry integrations; C1-UX5 interaction tests.

**Acceptance checks**

1. Native desktop and native mobile reach Home from navigation, palette, Library, reader and Review; graph/agent/dashboard launches preserve their supplied durable ids without side effects before Create.
2. A two-document manual plan with objective, source ref, edge, lock and activity saves, publishes and reopens after simulated process restart with identical logical ids/version/order. No AI/provider call occurs.
3. Goal 201 scalar values, >24 documents, >200 extracts, >1,600-char excerpt and invalid locator are refused without truncation or partial create.
4. Cycle, dangling edge and out-of-bounds move preserve the prior list; error shows concrete cycle/valid range. Tombstone restore/removal and lock conflict appear in diff and survive regeneration-base semantics.
5. Material coverage, activity and demonstrated evidence are independently labelled; manual activity never changes evidence; unknown coverage is not zero or mastery.
6. Simulated storage failure keeps dirty fields/response-free draft and no success toast; stale CAS never overwrites silently. Plan Delete detaches exam heads only after those exist and leaves library untouched.
7. PWA navigation visibly reaches Unsupported, invokes no Study native command and produces no persisted-looking row/import. Whole-database backup wording does not imply app-state JSON/two-way sync support.
8. Legacy retry returns the same imported ids/counts; malformed/cyclic items appear in preview; old key remains until accepted commit completes.

### C2 — `generate-source-grounded-study-curricula`

**Tasks:** C2-UX1 preflight/job progress/recovery; C2-UX2 generation issues/checkpoint preview; C2-UX3 diff/locks/tombstones/rebase acceptance; C2-UX4 rules-outline and coverage limitations.

**Acceptance checks**

1. Start discloses generation and embedding routes independently, payload classes/counts, maximum calls and cost. Denied privacy/cost/local-only/excluded-source does not start inference or mark Running.
2. Fake-provider checkpoints survive injected restart/cancel; late old-epoch output adds no node. Resume requires fresh preflight and never auto-selects cloud.
3. Cancelled/failed/partial drafts expose exact completed/total steps and valid retained nodes. Invalid handles become issues/deficits rather than swapped citations.
4. `source_changed` preserves previous published head and blocks mixed-evidence acceptance. Stale plan head preserves draft and requires explicit rebase/diff.
5. Rules-only outline works with no provider and contains no inferred rationales/edges; document-only nodes are marked coarse/limited. Index partial/unavailable and retrieval omissions are visible.
6. Coverage refresh does not run implicitly off-device, writes no evidence state and never labels content read/covered as understood.

### C3 — `generate-study-plan-examinations`

**Tasks:** C3-UX1 configuration/quota/source builder; C3-UX2 five-kind manual editor; C3-UX3 generation/checkpoints/shortfall; C3-UX4 author/learner preview and immutable revision history.

**Acceptance checks**

1. All five kinds can be manually authored, validated, published and reopened offline; example invalid options/cloze blanks/key facts/rubrics/source handles link to exact fields and never reach Ready.
2. Quota allocation displays exact requested marginals and stable slot properties. Configuration changes produce disclosed deficits, not silent question substitution.
3. Requested 30/valid 17 remains Needs Review until retry/edit; Publish is blocked until exact “Accept 17 of 30” acknowledgement. Config change revokes acknowledgement.
4. Learner preview's passed object and DOM contain no key/accepted/reference/expected reasoning/private rubric/explanation fields. Test copy makes no security/secrecy claim.
5. Edit Ready creates a new Draft; original committed payload and attempts remain readable/unchanged. Committed-update rejection is surfaced without losing new draft text.
6. No-provider generation action is explanatory while manual Add/Publish works; generated drafts checkpoint on fake provider errors/cancel without quota fabrication.

### C4 — `implement-resumable-examination-sessions`

**Tasks:** C4-UX1 Start confirmation/idempotent attempt creation; C4-UX2 typed response runner/save/mobile lifecycle; C4-UX3 Exam-vs-Practice policies/submit/expiry; C4-UX4 objective results/history/cancel/delete.

**Acceptance checks**

1. Start succeeds only from Ready and pins ordered question revisions. Repeated Start with one client key yields one attempt; normal navigation/check/save makes no provider or scheduler call.
2. Every response kind is keyboard/screen-reader usable; multi discloses all-or-nothing, cloze blank order/labels are stable, and response kind/id/size failures do not partially persist.
3. Save indicator follows acknowledgement through debounce/navigation/blur/hidden/suspend. Injected failure never says Saved. Restart restores only confirmed work unless an acknowledged flush confirms more.
4. Exam/Diagnostic (when later exposed) reveal no private field/correctness before final Submit; Practice exposes feedback only after committed Check, retains increasing ordinals and remains InProgress until Finish.
5. Double Submit creates one response-submission set/grade set; skipped and unanswered remain distinct zero outcomes. Subjective unresolved work leaves official total null.
6. Deadline survives close/suspension and expiry submits confirmed work with `timer`/`timer-recovered`; untimed Practice has no deadline or timer control.
7. Cancel preserves read-only responses with no evidence/grade fabrication. Permanent attempt deletion removes derived exam links but not documents/cards/Review records.
8. History compares only final attempts and labels same-paper memory effects/different-paper non-equivalence without causal improvement copy.

### C5 — `implement-rubric-based-exam-grading`

**Tasks:** C5-UX1 grading progress/failure/retry preflight; C5-UX2 criterion/provenance/report detail; C5-UX3 append-only manual correction/history.

**Acceptance checks**

1. Submit retains all answers if provider is absent/times out/malformed; blank short/essay receive deterministic zero without inference, while nonblank non-exact prose is Pending/Needs Review rather than automatically wrong.
2. Report displays criterion levels/weights, exact response quotations and application formula; changing model `score`/`completeness`/confidence fixture does not change exam points.
3. Contradictory classification, missing/duplicate criterion, non-substring quote, disallowed handle, `not-assessable` and non-reasoning essay fallback never become an unquestioned Final official score.
4. Retry discloses answer/reference/rubric destination and billable status again where required, uses same immutable inputs and appends rather than replaces grade history.
5. Manual Review requires every criterion level/reason; commit recomputes aggregates and preserves previous current grade. Automatic retry cannot silently supersede Manual.
6. PartiallyGraded/GradingFailed official totals remain null, Retry recovers, and learner/source text never appears in sanitized error diagnostics.

### C6 — `derive-study-gaps-from-exam-evidence`

**Tasks:** C6-UX1 evidence-v1 explanation/three-indicator separation; C6-UX2 gaps/rules/refresh/dismissal; C6-UX3 source-linked remediation/history correction/delete.

**Acceptance checks**

1. Fixture with same content read but no final assessment shows activity/coverage independently and Insufficient evidence; one wrong response does not produce Repeated Failure or a mastery percentage.
2. Sparse/conflicting/hinted/AI/repeated/stale fixture displays matching uncertainty reasons, independent sessions/days and labelled weighted observed performance. Pending grades do not settle evidence.
3. Manual correction updates the same evidence contribution exactly once and recomputes report/gaps; Review/FSRS/Queue command spies and snapshots remain unchanged.
4. Explicit local Refresh is chunked/cancellable and performs no AI or interruption of active Review/reading. Dismissal survives restart and does not erase evidence.
5. Every gap exposes rule id and inspectable evidence links. Source deletion keeps result/excerpt available, disables missing navigation, and future new-generation scope excludes it.
6. Attempt-history delete recomputes affected summaries/gaps before returning; detached plan/deleted concept history retains readable labels.

### C7 — `integrate-study-plans-with-adaptive-practice`

**Tasks:** C7-UX1 optional diagnostic wizard/application; C7-UX2 scoped tutor bidirectional handoff; C7-UX3 targeted practice/follow-up/plan adjustment; C7-UX4 existing card-proposal handoff only.

**Acceptance checks**

1. Before C7 no Diagnostic step/mode control is exposed. At C7 Skip creates no inference, attempt or evidence; length is restricted 4–12/default 6/untimed with objective or short-answer kinds only (no Essay); no feedback appears before Submit.
2. Incomplete/grading-failed diagnostic offers Resume/manual resolution/Skip; only explicit **Use these results** with final evidence creates a reviewable diagnostic-adaptation draft, never auto-publish.
3. Tutor retrieval spy receives `filters.documentIds` on each relevant Study session and only bounded approved excerpts/objectives/evidence are supplied. Closing tutor writes no evidence/card by itself.
4. Targeted Practice/Follow-up creates a Draft only, not an auto-started attempt; hints/check history and repeat-weight disclosures follow shared contracts.
5. Card Proposals opens the existing preview. Reject/Close creates zero cards; only ordinary explicit acceptance creates normal scheduled cards, with no automatic FSRS rating/priority/due-date write.
6. Plan Adjustment retains locks/tombstones and shows diff before Publish; weak-topic → source/tutor/practice → optional accepted cards → reassessment requires no manual context reconstruction.

### C8 — `validate-study-plans-and-examinations-end-to-end`

**Tasks:** C8-UX1 keyboard/screen-reader/contrast/reflow/reduced-motion qualification; C8-UX2 native desktop/mobile lifecycle/offline/PWA refusal; C8-UX3 cross-entry no-provider/error/shortfall/source-deletion golden journeys; C8-UX4 copy/i18n/no-scheduler audit.

**Acceptance gates**

1. Axe plus manual keyboard checks cover Home, wizard, editor/diff, all response kinds, builder, shortfall dialog, grading/manual review, history and remediation on desktop and native phone fixtures. No drag/swipe/color-only path exists.
2. Focus order/return, live announcements, 320-CSS-pixel reflow, 200% text zoom, 44×44 targets, contrast and reduced-motion/e-ink behavior pass; no timer/save live-region flooding is observed.
3. Physical native mobile suspension/orientation/process restart during editing, generation, response entry and grading restores documented state. Paid/cloud work never auto-resumes; timer recovery never claims unacknowledged keystrokes.
4. Offline completes manual plan, manual paper, objective attempt/results/history/source snapshot inspection. No-provider and provider-failure branches preserve all durable work.
5. PWA refusal is demonstrated without false rows or unknown-command defaults. Native SQLite is the only durable store; JSON export/sync copy makes no unsupported Study Plans claim.
6. Golden 30-step scenario passes with deterministic fixtures/fake providers; real-model/device quality is separately labelled qualified/not qualified and never inferred from deterministic test success.
7. Source stale/delete, plan delete/detach, attempt delete, shortfall acceptance, job/attempt cancellation, stale CAS and corrupt/new-version rows all match this document's visible states and leave no scheduler mutation.
8. All six locale modules contain the new visible keys, interpolated counts/plurals are tested, and no raw source/learner/provider secret appears in logs/toasts/error details.

## 8. Contract reconciliation required for the Practice action

Basic Practice **Check** uses shared `check_practice_response(CheckPracticeInput)` from `02-SHARED-CONTRACTS.md` §11, owned by C4-T06. Its native transaction validates InProgress+Practice+response CAS, flushes the supplied current response, appends the next immutable `practice-check` ordinal with payload/mark/hintLevel, writes applicable objective grades and returns a `PracticeCheckResult`; replaying the same client Check mutation reconciles rather than duplicating. Finish uses normal Submit with the shared equality/dedup rule. **The UI MUST NOT emulate Check with Exam Submit, direct SQL or an in-memory fake submission.** C7-T02/T05 extend the same contract with committed hints/guided remediation without another submission engine.
