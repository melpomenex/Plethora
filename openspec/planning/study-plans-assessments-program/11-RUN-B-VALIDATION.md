# Run B Validation and Final Review

**Scope:** architecture/specification documents only. This is not an implementation or production-test report.  
**Baseline:** `main@340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481` at audit start. Run A research and all Run B artifacts are untracked documentation additions; production sources were not modified.

## 1. Verification actually executed

| Command / check | Actual result | Interpretation |
|---|---|---|
| `openspec --version` | `1.13.0` | CLI and schema available |
| `openspec validate <each of eight slugs> --type change --strict --no-interactive` | Each of C1–C8 returned `Change ... is valid` after authoring | All eight individual change artifacts strict-valid; C8's zero deltas are accepted only because `skip_specs:true` |
| `openspec status --change <slug> --json` for all eight | `isPlanningComplete=true`, `applyRequires=["tasks"]` for each | Required proposal/design/spec/task artifacts present |
| `openspec validate --all --strict --no-interactive` | Repository-wide **675 passed, 54 failed (729 items)**, exit 1 | The whole repository has many unrelated existing strict errors/warnings in tracked specs/changes (e.g. missing Purpose, no-delta changes, incomplete MODIFIED blocks). All eight new changes appeared with ✓. This global baseline failure is **not** claimed as passed or fixed out of scope |
| `npm run docs:validate` | Inspected 76 canonical product docs; all passed, 0 errors | Applies to docs/product; does not prove production feature/readiness |
| Inline Python relative-Markdown-link audit | Checked 45 program/change Markdown files, 91 link tokens; 0 broken relative links | No missing local planning/change link targets at this audit |
| Inline Python task ID audit | 73 unique task IDs, no duplicates, no unresolved local/dependency/trace task references | Mechanical cross-reference consistency only, not implementation proof |
| Inline Python trace audit | OBJ 1–26 = 26/26; V rows=20/20; risk R01–R36 references=36/36; no former blocker wording | Every original objective has implementation/evidence mapping |
| Inline Python SQLite DDL sandbox | Executed all 6 illustrative SQL blocks against in-memory SQLite with a stub `concepts` table and foreign keys enabled; created 27 domain tables + 2 immutability/history triggers; `PRAGMA foreign_key_check` returned no rows | Syntax/FK metadata sanity only. It is **not** the production migration registry/Rust migration test and must not be cited as user data migration evidence |

No production TypeScript/Rust tests, build, `bench:check`, real-model evaluation, physical-device test, native backup restore, or mobile lifecycle execution was performed in Run B because no implementation exists yet. They are specified as owning-task/C8 gates, not claimed results. No dependencies were installed and no git commit/branch/push/PR was created.

## 2. Run A verification outcome

The completed Run A handoff and all seven supporting reports were consumed. Targeted call-site verification confirmed the broad “artifact layer missing/plumbing exists” conclusion while materially correcting:

- Existing single-select MCQ flashcards and deterministic review predicates exist, but are not exam artifacts or general multi-select/attempt grading.
- `AnswerAssessment` rejects out-of-range values; `review_result_id` has a legacy integer-vs-current-text mismatch and exam review storage must remain separate.
- `LlmRequestPolicy` is token budgeting, not consent. Provider locality requires endpoint destination/privacy gates.
- The learning agent is production-wired but budgets/draft tools still do not fit durable curriculum/exam generation.
- Domain-specific persisted work exists, but no general reusable AI job service; the new narrow Study job ledger is justified.
- Source fingerprints/revisions on existing envelopes do not by themselves provide durable revision validation; chunk ids are cache identities, local video needs focused extracts, and coverage stale/removed codes/graph orphan specs are not general persisted artifact lifecycle implementations.
- Browser-backend unknown command defaults, command/navigation registration and backup/app-state JSON/two-way sync distinctions are first-class constraints.

The full correction list is in [00-MASTER-PLAN.md](00-MASTER-PLAN.md) §9; source paths and exact APIs/callers were verified by focused reads rather than repeating the exhaustive Run A investigation.

## 3. Principal-architect review

| Review question | Result / contract evidence |
|---|---|
| Coherent domain/data ownership | Plan owns its goal/version graph; source evidence is shared separately; blueprints/questions/attempts/grades/evidence have distinct ownership and no card duplication or redundant document records. See 02/04. |
| Migration safety | Five fresh-numbered additive migrations planned; C5/C7/C8 normally reuse existing new tables. SQL sandbox/FK check passed as design sanity; each implementation still must run true fresh+prior DB migration/failure tests. |
| State machines/recovery | Plan and blueprint Draft/Publish heads use CAS; attempt states/transitions, submission/grade evidence, job leases/cancel epoch and restart/resume are specified in 02 §§3/7/10 and failure matrix in 01 §7. |
| Source evidence integrity | Every Ready question requires application-validated current evidence. Historical refs/results survive deletion with explicit stale/missing resolution; chunk ids/citations alone are insufficient. |
| Grading soundness | Objective pure rules and multi/cloze policy are closed; model cannot supply official aggregate totals/confidence-derived scores. Criteria formula and manual/AI history are specified. Failed/pending output retains answers without inventing points. |
| AI trust boundaries | Containment, no model tools, fail-closed validators, local ids and source hydration are mandatory. **Run B correction:** C2 `runPinnedStudyTask` uses `options.provider=route.provider` after explicit route resolution, because using only `resolvedProvider` leaves runTask alternate-provider recovery available. Provider failure now has no undisclosed alternate fallback by construction. |
| Uncertainty/pedagogy | Unsupported content, source/material coverage, activity and observed assessment performance stay separate. Evidence-v1 deliberately avoids uncalibrated percent mastery; repetition/independence/hints/AI/self-report uncertainty and real-model limits are exposed. |
| Incremental utility | C1 is useful without AI; C2 adds curricula; C3 fixed papers/manual authoring; C4 fully usable offline objective exams; C5–C7 progressively complete semantic grading/gaps/adaptive loop. Diagnostics have no forward dependency. |
| Provider/cost truth | Preflight is endpoint-aware, generation and embedding are independent, and `maximumModelCalls=2×plannedModelSteps` accounts for initial + one schema repair; alternate-provider retries are suppressed and user retry/re-grade gets new authorization. At-least-once inference is not advertised as exactly-once billing. |
| Existing change conflicts | The misleading card-quality change is untouched and not a dependency. Existing capabilities are extended; only assessment-blueprints/exam-sessions are new. C6 also updates the canonical Progress requirement to remove silent numeric targetMastery incompatibilities. |

## 4. Less-capable-implementation-agent review

| Required property | Readiness result |
|---|---|
| Exact files and APIs | Each of 73 tasks lists owning scope/files and whether NEW at baseline or dependency-owned. Existing integration paths/APIs were verified. Later agents still re-derive current callers, migration head and active changes at implementation time because source can evolve. |
| Complete contracts | 02 supplies identifier/text bounds, source/plan/blueprint/question/response/rubric/grade/attempt/job/evidence/remediation types, command names, CAS/idempotency and error codes. No separate model may invent an alternate union/state/mastery definition. |
| Deterministic algorithms | Strict Kahn+heap ties/cycle behavior, dependency-safe moves, largest remainder + slot construction, repeat deficits, exact scoring, rubric weighted formula, evidence-v1 and task pinning are fully specified with bounds/examples. |
| Failure semantics | Each change covers absent source/provider, denied privacy/cost, malformed data/output, timeout, cancellation, storage failure, partial generation/grading, restart and retry. Shared §11 transactions/name ownership are authoritative. |
| Bounded task scope | Shared pure validation → migration → repository/commands → adapters/tasks → UI → tests/integration progression is explicit. If native implementation of a single aggregate task exceeds one session, split it at compile-safe transaction boundaries while retaining its ID/test obligations; do not weaken it or defer behavior to UI-only code. |
| Shared-change ownership | 03 §2 defines modification order; C2 owns jobs, C3 questions, C4 attempt+full grade schema, C5 rubric logic, C6 evidence, C7 integration. No simultaneous edits to active flashcard conflict files. |
| Tests and completion evidence | Every task has concrete negative cases and Done criteria; every change has required actual commands and user-entry/persistence checks. A new file, compile, checked box or schema alone is explicitly insufficient. |
| Resolved authoring pitfalls | Added real `check_practice_response`; Practice Finish dedups only identical response+mark+hintLevel. Manual `CriterionResult` needs no fabricated AI quote. Failed-grade insertion/current semantics are separated from pre-request job failure. Committed direct update/reparent is forbidden; only explicit whole-unused-blueprint deletion is allowed by C3, with C4 history guard. |
| Existing-function precision | C7 exports the actual private `candidateSignature` rather than inventing/importing a nonexistent public function; static Cloze candidates also receive explicit fields. Tutor integration uses existing `TutorRuntime.retrieve`; `TutorSession` policy implementation stays unchanged. |

## 5. Plethora-user review

| Required user experience | Specified owner / exact outcome |
|---|---|
| Choose real library material and a goal | C1 scope picker/frozen concrete ids, goal validation and plan persistence; Library/Reader/Graph/Review/Agent/Dashboard entries preserve context |
| Generate/customize/save/reopen curriculum | C1 manual editor/strict DAG/locks/tombstones/diffs + C2 bounded generation/rules outline/cancel/resume/publish |
| Choose exam length/types/difficulty/topics/timing | C3 blueprint builder with deterministic quotas/points/scoring, recent-question exclusions and explicit shortfall acceptance |
| Take on desktop/mobile and resume | C4 typed accessible runner, offline save/restart/lifecycle/timer/reconcile/cancel and fixed pinned questions |
| Understand objective/subjective grading | C4 pure scores and per-item explanations + C5 criteria/evidence/provider/manual history, no model holistic-score shortcut |
| See reasoned weaknesses and uncertainty | C6 evidence/gap rule explanations, source/block/history evidence and conservative sparse/repeat/conflict reasons rather than fake mastery certainty |
| Navigate to source and remediate | C1 source adapter with correct PDF/EPUB/text/media/extract routes; C6/C7 source/tutor/practice/follow-up/plan/card flows |
| Practice, optional cards, reassess improvement | C4/C7 Check/hints/repeat rounds, retry-safe optional Learn This acceptance, same/new paper options and qualified C6 history |
| Offline and privacy | Saved artifacts and objective/manual/evidence workflows offline; all inference authorized per provider/destination/source/answer with no silent paid/cloud fallback |
| No FSRS/Queue surprises | Exam questions are never learning items; no ratings/schedule/orders/priority writes. Only user-accepted remediation cards intentionally enter ordinary scheduling. |

The specified user path is complete on paper, but not yet a working feature. It must remain unreachable/unadvertised where prior task evidence is absent, and C8—not architecture prose—must provide real usability/platform/model proof.

## 6. Definition-of-done cross-check for Run B documents

- [x] Run A files consumed and critical findings source-verified/corrected.
- [x] Existing active capabilities/conflicts partitioned; misleading active change unmodified.
- [x] Architecture/ADRs/source/assessment/grading/state/evidence/remediation/tutor/provider/privacy/offline/job/security boundaries chosen.
- [x] Data ownership, concrete SQL, migrations, localStorage reconciliation, backup/sync/deletion and compatibility contracts authored.
- [x] Plans, prerequisites, diagnostics, five question types, key commitment, rubric grading, attempt recovery and historical evidence specified.
- [x] UX entry points/screens/loading/empty/error/offline/responsive/a11y/mobile states specified.
- [x] Eight bounded dependency-ordered changes with 73 precise tasks and acceptance gates created.
- [x] All 26 original objectives, 20 cross-cutting verification concerns, 30 golden steps and 36 risks mapped to tasks/evidence.
- [x] Individual strict OpenSpec validation and mechanical docs/contracts checks actually executed; global existing failures reported honestly.
- [x] Handoff contains executable start sequence, exact prompts, commands, recovery rules and file ownership.
- [x] No production implementation, dependencies, git mutations, or fabricated production/test claims introduced.

**Run B documentation is implementation-ready as an architectural program. Implementation and qualification remain entirely future work; physical-device/real-model readiness is not being claimed.**
