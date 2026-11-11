# Study Plans and Assessments implementation audit

November 11, 2026 · `main` · baseline `8af1e23a29ed3dbca900906a37525352347a7be7`

The baseline worktree was clean. The audit covers the eight changes in the [master plan](00-MASTER-PLAN.md), the original [acceptance matrix](06-TRACEABILITY-MATRIX.md), and the [30-step golden scenario](07-GOLDEN-SCENARIO.md). The baseline's final planning review is [11-RUN-B-VALIDATION.md](11-RUN-B-VALIDATION.md). The audit changes are committed on `main` immediately after the baseline. No real inference, paid embeddings, or user-library fixture data were used for verification.

**Release decision: No-Go for the complete learning cycle.** The most severe failures were in Dashboard navigation, the cloud authorization path, exact-model enforcement, and source integrity. Those paths now have production changes and focused regression coverage. The remaining gaps include diagnostic application, a reachable scoped tutor and card-proposal flow, reassessment history across sessions, and native/provider qualification. The previous C8 manifest is insufficient evidence for a release.

## OpenSpec coverage

| Change | Production behavior examined and changed | Current qualification |
| --- | --- | --- |
| C1 · `establish-persistent-study-plans` | Dashboard and typed navigation now open the canonical tab. Create resolves concrete library scope and saves through the native API. Native save uses a transactional CAS. Publish checks topics, DAG and current citations. The editor uses the saved revision when publishing and opens citations through the canonical reader adapter. | Layout/React integration, SQLite repository coverage, and source-adapter tests. Exact viewer behavior for real EPUB, PDF, audio, YouTube, and local video and the complete version-history/editing matrix still need native exercise. |
| C2 · `generate-source-grounded-study-curricula` | Exact configured model, separate inspection and consent, independently classified embeddings, bounded calls, current in-scope evidence, transactional reference persistence, fresh authorization on recovery, and deterministic outline. | Fake-transport, focused orchestration, source resolver, and Chromium fixture coverage. Semantic quality, endpoint/provider availability, and real restart/cancellation recovery remain unqualified. |
| C3 · `generate-study-plan-examinations` | Source-only questions use current persisted references from the pinned plan version. The builder displays authorization, saves before starting, and exposes manual add/edit on draft slots. Coordinator completion uses the same step hash as the lease. | Builder/editor, quota, schema and coordinator tests. Separate real model and complete fixed-paper journey remain unqualified. |
| C4 · `implement-resumable-examination-sessions` | SQLite attempt commands/repository, typed runner, pinned questions, response mutation IDs, scoring, and practice Check/Finish paths are present. Attempts now return a safe projection of their pinned question payloads. Settlement scores natively from committed answer keys, reserves the attempt row under CAS, and rejects responses after the deadline. Typed Study Plans actions open the runner, and saved attempts are reachable from a new Assessment history view. | Repository/component evidence, including leakage, scoring and history suites. Physical process kill, suspend, deadline recovery, and all answer formats in one native journey remain unverified. |
| C5 · `implement-rubric-based-exam-grading` | Results expose an explicit AI grading action for eligible written responses and refresh after manual correction. Authorization precedes the grading job. The job receives committed current source passages and the authorized route. | Rubric/criterion, exact-match, manual correction, and coordinator tests exercise individual layers. Real model agreement, provider quality, and complete retry/history behavior across app restart remain unqualified. |
| C6 · `derive-study-gaps-from-exam-evidence` | Final-grade evidence and gap aggregation exist. The plan progress tab now connects current plan gaps to native dismissal and linked source actions. | Evidence math and native settlement have focused tests. The golden evidence rows, exact 9/15 scenario and resulting gap sequence still need an integrated run. |
| C7 · `integrate-study-plans-with-adaptive-practice` | Practice and follow-up draft creation are reachable from an assessment-derived gap and carry the plan/topic context. Existing fixed-paper runner retains practice controls. The diagnostic, scoped Tutor, and explicit card proposal building blocks exist. | Partial. The complete diagnostic Take/Skip/Apply and Tutor/card proposal flows have no verified production journey. Difficulty adaptation, fingerprint exclusions across attempts, comparisons, and return behavior are incompletely qualified. |
| C8 · `validate-study-plans-and-examinations-end-to-end` | Individual strict OpenSpec checks ran for all eight. The existing `goldenAssertions.ts` assigns several steps a literal success predicate and the Playwright smoke only checks that the page body is visible. | Incomplete. Its nine unchecked tasks remain unchecked. Native cross-layer golden and adversarial scenarios, devices, pedagogy, accessibility matrix, and release evidence remain open. |

### Objective-level trace

| Objective | Evidence and remaining gap |
| --- | --- |
| OBJ-01 · Frozen source scope | `resolveStudySourceScope` freezes selected documents/extracts and expands collection/tag inputs via existing native APIs. Create picker browses documents and accepts prefilled extract/collection/tag IDs. Independent collection/tag/extract browsing and exact selection-text seeding remain incomplete. |
| OBJ-02 · Durable learning goal | `StudyPlanCreateForm` validates and calls `createStudyPlan`. The native repository owns the goal and the initial version. |
| OBJ-03 · Optional diagnostic | Diagnostic config/adapter/components have focused tests. The pre-generation Take/Skip/Resume/Apply sequence remains unwired in the main wizard. |
| OBJ-04 · Source-grounded and offline curriculum | Configured-route, evidence, coordinator and outline tests cover pinning, empty/stale retrieval, checkpoints, and metadata-only output. Human subject-matter validation is pending. |
| OBJ-05 · Prerequisites and order | TypeScript topology tests cover DAG and cycles. Publish validates the native DAG. Confirmed outline edges stay plan-local. Exact reordering/lock conflicts still need a native editor journey. |
| OBJ-06 · Safe editing and regeneration | Editor passes CAS revision from acknowledged saves. Merge tests cover locks, user edits and tombstones. Concurrent edits and restart through the full editor UI remain unqualified. |
| OBJ-07 · Expand plans | Merge and draft APIs support new nodes. Version/scope expansion, source refresh and re-publication need a complete user journey. |
| OBJ-08 · Remove topics | Merge tests preserve removal tombstones. Restart and later gap reevaluation remain unverified together. |
| OBJ-09 · Lock topics | Merge/topology tests cover lock precedence and ordering. Conflict acknowledgement needs native end-to-end proof. |
| OBJ-10 · Open supporting source | Plan editor uses `openStudySource`; stale refs can open the document coarsely. Locator/codec/device matrix is open. |
| OBJ-11 · Durable recovery | Attempt repositories and coordinator checkpoints provide storage paths. Curriculum recovery matches evidence and route with fresh consent; full native restart and timer recovery remain open. |
| OBJ-12 · Scoped tutor | `StudyTutorHost` and its scope/privacy tests exist. The primary gap workflow does not yet mount the host. |
| OBJ-13 · Fixed exams and honest shortfalls | Assessment builder, quota planner and Ready-only start path. Full timing and shortfall acceptance on a native app still need exercise. |
| OBJ-14 · Five formats | Existing discriminated schemas, manual question editor, attempt components and tests. Cross-format author/publish/answer/reopen in one session remains unqualified. |
| OBJ-15 · Difficulty and practice | Quota and practice rules exist. Next-paper adaptive difficulty is not fully wired into the new gap entry. |
| OBJ-16 · Scope and coverage | Plan-version references and quota targets now reach assessment generation. Exact goal/question coverage remains subject to review. |
| OBJ-17 · Responsive and accessible UI | Chromium at 320, 390 and 1360 px verified form reflow, keyboard source selection and wizard focus/consent using synthetic IPC. Full native, screen reader, zoom, reduced-motion, and contrast matrix remains open. |
| OBJ-18 · Objective/rubric/manual grading | Objective scoring tests and existing native graders; explicit rubric consent and manual refresh are wired. Real response evaluation is unqualified. |
| OBJ-19 · Transparent results | Existing results/criterion views expose grading details. Coverage of all source navigation and explanation affordances remains partial. |
| OBJ-20 · Explainable gaps | Aggregation/gap tests and plan progress/source/dismissal wiring. The multi-attempt golden arithmetic is still unqualified. |
| OBJ-21 · Optional remediation | Current gap source actions, dismissal, and draft launch exist. Full Tutor/return integration is incomplete. |
| OBJ-22 · Practice, hints and cards | Fixed-paper practice and hints have tests. Card proposal adapters are isolated from the active gap UI. |
| OBJ-23 · Retake and fresh follow-up | Existing retake and new gap draft entry. Freshness checks against all past fingerprints and comparison history remain incomplete. |
| OBJ-24 · History | Native version/attempt/grade history exists, and Study Plans now exposes an Assessment history view that opens results or resumes in-progress attempts. Full history traversal and backup/restore across the complete cycle remain unqualified. |
| OBJ-25 · Offline operation | Manual plan creation, deterministic source outline, objective grading, manual rubric and browser refusal have focused evidence. Complete offline native restart scenario remains open. |
| OBJ-26 · AI authorization | Independent destination/consent checks, exact configured generation model, frozen embedding settings and redacted persistence. Vendor model aliases are refused where known. Real endpoint behavior and native system model identity still require qualification. |

## Defects and fixes

| ID | Severity | Confirmed cause | Remediation and evidence |
| --- | --- | --- | --- |
| NAV-01 | P0 | MainLayout's local tab map omitted Study Plans while the toolbar registry knew it. | Canonical fallback, active-pane destination tests in `MainLayout.defaultView.test.tsx`, and Dashboard error feedback. |
| AUTH-01 | P0 | Inspection threw for absent consent before the UI could show the checkboxes. | Inspect produces the disclosure without inference. Execution enforces both consents and revalidates source policy, route identity and endpoint. Covered by `curriculumGenerationUI.test.tsx`, `preflight.test.ts`, and `configuredRoute.test.ts`. |
| AUTH-02 | P0 | All cloud configurations appeared as the mutable `cloud-llm` singleton. | Reuse `PinnedCloudProvider`, capture config/model/endpoint, use same provider for both curriculum tasks, and disable HTTP redirects and environment proxies on the pinned native request. The wire test sees the selected exact API model ID after a settings change. |
| RET-01 | P0 | Query retrieval could inherit mutable native embedding settings without a Study Plans authorization. | Study calls use isolated config in the existing IPC command and require both the app's paid-embedding setting and the job's applicable consents. Explicit endpoint/model or native default is used without updating the indexer's shared config. |
| RET-02 | P1 | Empty/failed search produced document titles as evidence, invalid reference results could be sent, and dedup could misalign IDs and excerpts. | Filter to scope and current exact snapshots, align refs by evidence tuple, report actual mode, and stop before the LLM with zero verified passages. Evidence tests exercise scoped/stale/zero-hit inputs. |
| SRC-01 | P1 | Source resolution allocated provisional IDs but did not insert rows. | Save resolves supplied snapshots, upserts references in the draft transaction, and links canonical IDs. Read revalidates the historical snapshot against the live source. Native repository citation test exercises save/reopen. |
| FORM-01 | P1 | Creation persisted empty resolved metadata and initialized all generators in AI mode. | Resolve source IDs/revisions/privacy on create, preserve selected mode, use real checkboxes, and keep form inputs after a failed save. |
| GEN-01 | P1 | Two advertised steps ignored additional evidence batches, and the job UI could not recover the correct target. | Reserve 20 calls for up to 9 decomposition batches plus prerequisites and one schema correction per stage. Enforce the stage count before inference, reauthorize resume, and validate the checkpoint fingerprint. |
| OUTLINE-01 | P1 | Metadata-generated placeholder units and sequential prerequisites appeared passage-grounded. | Outline uses document inventory, confirmed concepts and confirmed links. It reports coarse metadata, with zero fabricated references and no LLM/embedding calls. |
| EXAM-01 | P1 | Question generation used title strings as passages, swallowed draft save errors, and completed leases with the wrong input hash. | Resolve current committed plan refs, revalidate and pin, await save and pass the returned revision, complete the claimed hash, and expose manual editor. |
| GRADE-01 | P1 | Grading services had no results entry, produced placeholder snippets, and manual completion did not reload results. | Add a written-answer authorization action, pass current source excerpts and committed rubric to the existing task, and refresh results after grading. |
| ATTEMPT-01 | P0 | An attempt returned its pinned question IDs but no question payloads, so the runner could open with no questions. | Project the immutable revisions in pinned order, exposing draft-safe fields before submission and answers, hints, explanation and source references only when the attempt or practice check allows them. Native tests assert the unsubmitted payload does not leak private values. |
| ATTEMPT-02 | P0 | Settlement and practice checks trusted caller-supplied objective grades and did not validate the draft against the committed question; hints also trusted the caller's level. | Score every response natively from the committed answer key and display payload, validate option/blank/text shapes, cap hints at the committed count, reserve the attempt row under CAS, reject writes after the deadline, and return the authoritative response revision and explanation. |
| HISTORY-01 | P2 | Attempt history existed in the data layer but had no reachable Study Plans route. | Add the Assessment history view, wire it to results and in-progress attempts, and refresh the results view after grading. |
| EVID-01 | P1 | Gap source and dismissal callbacks were absent in the plan progress host. | Connect scope-matched gaps to source opening, evidence-cutoff dismissal and fixed-paper draft entry. |
| QA-01 | P1 | C8 counts synthetic placeholders as successful golden actions. | Record the discrepancy in C8 verification. Individual suites remain useful evidence for the behavior they actually exercise. |
| UI-01 | P2 | The source fieldset used its intrinsic min-content width and overflowed a 320 px viewport. | Make it shrink with the form. Chromium fixture rerun passed at all three sizes. |

## Routing, costs, and retrieval

- Curriculum offers the app default and usable configurations from the existing LLM provider store. Explicit selection uses its configuration ID, API model ID, and canonical endpoint. Before starting, settings are re-resolved and the disclosed identity is compared. The cloud request uses an in-memory snapshot and task-level fallback can change the prompt class on the same provider. Durable job data contains model metadata, endpoint origin/hash and bounded statistics. Native system adapters can lack a discoverable exact model ID.
- OpenRouter discovery reads the provider's advertised reasoning parameters when present. Missing catalog data uses the existing model-name heuristic as a routing hint, with uncertainty in the disclosure. Structured JSON validation and the single corrective request still apply. The provider's internal deployment choice behind a single exact API ID has not been independently verified. [OpenRouter model catalog](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- Estimate uses bounded passages, task output caps, cached provider prices where available, and a separate allowance for corrections. It is a planning estimate for first attempts. Unknown pricing stays unavailable. The approved call cap is a request count, not a dollar cap. The preview reports measured call counts for successful steps, reported tokens where supplied, corrections, and elapsed time. A cancelled in-flight provider request may have already reached the provider.
- Retrieval uses native semantic search with model/version-compatible vectors or native lexical fallback. The configured backend is disclosed before execution. The preview reports actual semantic, lexical, or mixed mode, semantic embedding IDs, number of queries, verified passages, and number of documents represented. Index count describes indexed chunks. It does not establish semantic coverage of all chapters. The native index inventory is capped, so ambiguous counts remain unverified.
- The curriculum searches up to 24 selected documents using the goal and up to 12 confirmed concept seeds. It keeps up to 96 unique passages, with 12 passages and 18,000 characters per batch, each excerpt capped at 1,600 characters. Scope filtering is repeated before evidence hydration and missing or stale passages are excluded. It does not index on the user's behalf. With a remote embedding backend, goal and in-scope concept queries may leave the device. Passage transfer belongs to the separate generation authorization.
- Passage validation checks identity, live revision and excerpt provenance. A valid citation can still be attached to a weak or irrelevant pedagogical claim by a model. Draft preview and explicit publication remain necessary. No-AI outline displays document metadata and confirmed graph relationships without pretending to parse tables of contents.

## Golden scenario evidence

| Steps | Executed evidence | Still required |
| --- | --- | --- |
| 1–3 | MainLayout tab open/activation; create form fixture; native plan storage tests. | Native combined Dashboard/reader/graph/mobile journey with actual source variants and atomic artifact checks. |
| 4–7 | Real preflight and fake transport test; source filters/limits; coordinator checkpoints; outline; native ref persistence. | Full synthetic corpus through actual native UI, real restart from durable checkpoint, and native publish/diff verification across a full run. |
| 8–11 | Builder and question editor; quota, source-ref, validation and generation coordinator suites. | Native two-batch six-item paper, immutable keys, shortfall and partial-write negative cases in one run. |
| 12–17 | Attempt/score/rubric/coordinator tests and native repository evidence. | Native quit/reopen, controlled timeout and retry, exact 9/15 result, and immutable history with that exact fixture. |
| 18–19 | Evidence and source-adapter suites. | Exact golden evidence states and device PDF/EPUB/video/audio/YouTube opening. |
| 20–24 | Focused practice/Tutor/card helper tests, scheduler regression. | Reachable tutor/card sequence and before/after SQLite scheduler sentinel across the whole path. |
| 25–27 | Follow-up draft/retake paths and evidence grouping tests. | Fresh fingerprints and golden R1/R2 evidence, gap resolution, and comparison through the actual UI. |
| 28–30 | Offline-oriented unit/API coverage, independent privacy and selection tests, source/citation checks. | Actual offline restart, SQLite backup/restore and native final-state manifest. |

## Verification commands

The gate status below distinguishes checks from this audit and evidence recorded by earlier implementation sessions.

<!-- GATE-RESULTS -->
| Gate | Result |
| --- | --- |
| `cargo fmt --check` | Pass. |
| Native focused tests | `exam_session_repository` 7/7 passed; `study_plan_repository` 4/4 passed. The same build compiled the full native library. |
| `npx tsc --noEmit` | 10 pre-existing error files, all also present at baseline (baseline had 12; two Study Plans errors were fixed). No new error file. |
| Focused Study Plans Vitest | 92 files / 553 tests passed, including configured-route, evidence, coordinator, source, assessment, attempt, grading, history and layout suites. |
| Full Vitest | 9,869 passed, 45 failed, 5 skipped. All 21 failing files also fail on the baseline checkout; the only baseline-only file is the Playwright `src/e2e/study-plans-golden.spec.ts`, now excluded from Vitest. No worktree-only failure remained. |
| `npm run docs:validate` | 76 product documentation files, 0 errors. |
| `npm run test:scripts` | 235/240 passed. Two failures reproduce on baseline. Three additional failures depend on ignored local artifacts: a PWA `dist/` metadata file, an ignored marketing fixture archive, and unattributed marketing screenshots. |
| Build and bundle budget | Vite production build passed; bundle budget passed at 27.7 MB. |
| `bench:check` | No Study Plans benchmark regression. Seven unrelated benchmarks fail and also fail on the baseline gate (which had ten); several other baselines report as stale in both runs. |
| OpenSpec | All eight Study Plans changes pass `openspec validate --type change --strict`. `openspec validate --all` still reports 54 unrelated repository failures. |
| ESLint on changed files | 0 errors; 14 pre-existing warnings. |
| Chromium UI fixture | Create and consent screens passed at 320, 390 and 1360 px with synthetic IPC: keyboard source selection, reflow, exact-model disclosure, both consent gates, and focus containment. The temporary fixture was removed. |
| Playwright E2E | Not run. The committed smoke still only asserts a visible page body; native/provider/device journeys remain manual. |

## Manual verification in Plethora

1. In the native app, enable an OpenRouter configuration with a concrete model ID in AI settings. Select your configured Mercury model if it is available in your catalog. Add a small document containing an identifiable passage and confirm the library has indexed it.
2. On Dashboard, choose **New plan**. Enter a title and learning objective, select the document, then choose **Generate with AI** and continue.
3. Choose the specific OpenRouter configuration. Confirm its exact ID, endpoint location, model class, the search backend, the model-call cap, and the price or unavailable estimate. Keep one approval unchecked and confirm generation remains disabled. Switch model and confirm both approvals clear.
4. Approve the transfer and charges only if intended, then start. Open **Generation details** in the preview. Verify actual retrieval mode, passages, and calls. Inspect the draft's supporting excerpt. Publish explicitly, reopen the plan, and open its source from the reader action.
5. Repeat from a separate plan using **Source Outline (No AI)**. Confirm the generator starts in Outline, and preview shows document inventory and confirmed links with no fabricated citations. Create and publish a manual plan with a topic/objective while AI is disabled.
6. From a published plan, open **Create Assessment**. Either author questions in the draft or approve scoped generation, review the fixed items and then publish. Start the paper, save a response, restart the app, resume the same attempt, and submit. For written responses, inspect the new grading disclosure or enter a manual grade and inspect the refreshed result.
7. Open plan progress and use a gap's source or practice/follow-up draft action. Inspect the targeted topic in the new builder. Explicitly publish and start the follow-up paper before making any comparison. Verify that app Review/FSRS/Queue state changed only in actions performed directly in those systems.

## Delegation and review

The primary agent owned architecture, privacy, endpoint/model pinning, retrieval and reference persistence, native changes, integration, gating, and the final audit. Luna Medium handled bounded packages. NAV-01 changed MainLayout, the Dashboard card and integration tests. CORE-TEST and RECOVERY-QA owned curriculum coordinator/evidence test fixtures. UI-01, OUTLINE-01, OUTLINE-LIVE and CONSENT-UI owned the creation/picker, outline and consent UI tests. QA-TRACE inspected C1/C3–C8 coverage. ASSESS-01 and ASSESS-MANUAL repaired the builder/coordinator and their tests. GRADE-UI covers the grading controls. The primary agent reviewed the patches and incorporated them into the focused gates. No agent-level token or cost telemetry was available.
