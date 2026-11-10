# Study Plans and Assessments — Master Plan

**Status:** architecture and implementation specification; no production implementation is included.  
**Verified baseline:** `main@340661b2c5a42bf0c2a8fb7d5a5d384f3ef04481`.  
**Product name:** **Study Plans**. The persistent capability remains the existing `adaptive-learning-paths`; Study Plans is the user-facing name, not a second curriculum capability.

## 1. Product objective

Turn a user's own library into an editable, source-grounded learning cycle:

**Material → Study Plan → Learning → Practice → Examination → Transparent grading → Evidence-backed gaps → Remediation → Reassessment.**

A learner can select documents, extracts, collections, tags, books, lecture notes, audio/video and transcripts; state a goal; optionally take a diagnostic; generate and edit a curriculum; configure and preview fixed assessments; take and resume them; inspect objective and rubric grading; understand the evidence behind weak areas; open the supporting material; use the existing tutor and card proposals; and compare reassessment history.

## 2. Major architecture

The program adds the missing **artifact layer** above Plethora's existing AI plumbing:

```text
Library / reader / extracts / semantic retrieval / concepts
                         │
                         ▼
             locally validated source evidence
                         │
          ┌──────────────┴───────────────┐
          ▼                              ▼
 Study Plan aggregate              Assessment Blueprint
 goals + scoped source snapshot    quota slots + fixed questions
 versions + nodes + DAG + locks    committed keys + analytic rubrics
          │                              │
          │                              ▼
          │                       Attempt + saved responses
          │                              │
          │                    ┌─────────┴──────────┐
          │                    ▼                    ▼
          │              deterministic grades   rubric AI grades
          │                    └─────────┬──────────┘
          │                              ▼
          │                  append-only learning evidence
          │                              │
          ▼                              ▼
  study activity (not mastery)   conservative evidence states + gaps
                                           │
                                           ▼
                         source / tutor / practice / card proposals
                                           │
                                  optional user-approved actions
```

TypeScript owns pure domain validation, deterministic ordering/scoring, task orchestration, and React presentation. Rust owns SQLite transactions, optimistic concurrency, durable command contracts, generation leases, and deletion behavior. AI task definitions only propose typed data. Existing `runTask`, provider routing, destination classification and privacy gates are used; the model receives no domain write tools, filesystem access, or shell access.

Coverage (`coverage-v1`), study activity, demonstrated performance, and evidence-based knowledge gaps are distinct projections. A document being covered or read never proves understanding.

## 3. Integration boundaries

| Existing owner | Program use | Boundary that must remain intact |
|---|---|---|
| `src/api/ai-learning.ts` and Rust semantic index | Bounded retrieval with explicit `filters.documentIds` | Index is a cache; a chunk id alone is never durable provenance |
| `src/lib/ai/concepts/coverage.ts` | Content coverage and locators | No mastery input or writes; no change to `coverage-v1` |
| Concepts / `concept_links` | Canonical concept ids and accepted prerequisite suggestions | Model handles never mint ids; plan approval does not silently create graph edges |
| `runTask`, task registry, router and fake providers | All generation and AI grading | New tasks are contained, bounded, structured and fail-closed |
| `src/lib/ai/features/destinations.ts`, `privacyGate.ts`, cloud/cost consent | Endpoint-aware preflight and disclosure | `LlmRequestPolicy` is token budgeting only; it is not privacy authorization |
| `AnswerAssessment` and `assess-answer` | Free-response assessment envelope and short-answer semantics | Exam results use exam-owned persistence, not review `answer_assessments` rows |
| `TutorSession` / `TutorSheet` | Topic/source-scoped remediation | One small retrieval-injection extension; no competing tutor |
| Learn This / learning-agent approval | Optional card drafts and explicit acceptance | No automatic card, Queue, priority, rating, or FSRS mutation |
| SQLite / `migrations.rs` | Authoritative native artifacts | Additive migrations with fresh numeric names at implementation time |
| Navigation/tab registry and i18n | One native Study Plans destination | Registry, MainLayout, palette, mobile and capability gates must all be wired |
| Whole-database backup | Includes new SQLite tables | Two-way sync and the explicit app-state JSON format are not claimed automatically |

LearnHarness is an AGPL-3.0 architectural reference only. No source, schemas, prompts, Mermaid format, or substantial expression are copied. Plethora independently implements typed artifacts, application-assigned identities, database-enforced committed revisions, and deterministic rules.

## 4. Principal decisions

1. **Manual-first, versioned Study Plans in SQLite replace the orphan localStorage authority.** A plan directly owns one durable learning goal; DAQE session goals and reading goals remain unrelated.
2. **A plan is a plan of study, not AI-authored courseware.** Nodes contain objectives, source evidence, and prerequisite relationships; reader and tutor supply teaching.
3. **A prerequisite DAG is authoritative; display order is a constrained deterministic topological sequence.** Invalid manual reorder is rejected with a valid range. Locks survive drafts where structurally possible, with explained conflicts otherwise.
4. **Curriculum generation is staged and bounded by evidence batches.** A deterministic document/concept outline remains available without a model, explicitly labelled as less rich.
5. **Exams are fixed papers based on immutable blueprint revisions.** Adaptive behavior belongs to practice and follow-up blueprint creation, not mid-paper question replacement.
6. **One discriminated question model supports single-select, multi-select, cloze, short answer, essay, and application/reasoning objectives.** Practice and exam vary presentation policy, not schemas.
7. **Keys, reference answers, and rubrics are committed before an attempt.** Committed rows cannot be edited; user corrections create new revisions or grade history, never rewrite the original.
8. **Objective scoring is pure and deterministic.** Multi-select is all-or-nothing; cloze gives equal per-blank partial credit; no fuzzy or model score replaces an exact answer key.
9. **Short answers are exact-match-first, then rubric/AI; essays use committed analytic criteria.** Application logic calculates points from validated criterion levels. AI `confidence` is provenance, not calibrated certainty.
10. **Evidence is persistent and explainable; a scientific mastery percentage is not claimed.** Deterministic evidence states, observed-performance statistics, independence/repetition weights, recency, and uncertainty reasons replace an invented hybrid mastery score. Coverage and reading activity are excluded from demonstrated-performance calculations.
11. **Diagnostics are optional and owned by Change 7.** They reuse blueprint, generation, attempt and evidence infrastructure. Earlier changes neither block on nor invent a diagnostic engine.
12. **A narrow persisted Study Generation Job/step ledger supports curriculum, question and grading work.** It is not a general job platform. Recovery is explicit and consent-aware; stale leases and cancellation epochs suppress late writes.
13. **Source deletion preserves history.** Stored validated excerpts and historical document ids remain, but navigation reports missing/stale sources and future generation excludes them.
14. **Native desktop/mobile are supported targets.** Browser/PWA must show an explicit unsupported durable-storage state rather than silently dropping native commands. No silent cloud fallback is allowed.
15. **The existing card-quality change named `design-source-grounded-ai-curricula-and-assessments` is untouched.** This program never uses its misleading capability id and has no implementation dependency on its unlanded validators.

Decision rationale and alternatives are in [10-ARCHITECTURAL-DECISIONS.md](10-ARCHITECTURAL-DECISIONS.md). Canonical cross-change types are in [02-SHARED-CONTRACTS.md](02-SHARED-CONTRACTS.md).

## 5. Dependency-ordered implementation program

| Order | Change | Capability deltas | Depends on | Independently useful milestone |
|---:|---|---|---|---|
| 1 | [establish-persistent-study-plans](../../changes/establish-persistent-study-plans/proposal.md) | `adaptive-learning-paths` | None | Manually create, source-link, edit, lock, save, restart and reopen a plan without AI |
| 2 | [generate-source-grounded-study-curricula](../../changes/generate-source-grounded-study-curricula/proposal.md) | `adaptive-learning-paths` | 1 | Generate a bounded curriculum draft, inspect issues, preserve edits through version acceptance; includes a rules-only outline |
| 3 | [generate-study-plan-examinations](../../changes/generate-study-plan-examinations/proposal.md) | new `assessment-blueprints` | 1, 2 | Configure, generate, validate, edit and preview a fixed exam, including committed keys/rubrics; manual authoring works offline |
| 4 | [implement-resumable-examination-sessions](../../changes/implement-resumable-examination-sessions/proposal.md) | new `exam-sessions` | 3 | Take, save, resume, submit and deterministically score objective exams; retain history and basic practice checks |
| 5 | [implement-rubric-based-exam-grading](../../changes/implement-rubric-based-exam-grading/proposal.md) | `ai-answer-assessment` | 4 | Grade short answers/essays with criteria, provenance, failure recovery and auditable manual correction |
| 6 | [derive-study-gaps-from-exam-evidence](../../changes/derive-study-gaps-from-exam-evidence/proposal.md) | `knowledge-gap-detection`, `adaptive-learning-paths` | 5 | Explain weak concepts, uncertainty and historical outcomes; offer source-linked remediation without scheduler writes |
| 7 | [integrate-study-plans-with-adaptive-practice](../../changes/integrate-study-plans-with-adaptive-practice/proposal.md) | `adaptive-learning-paths`, `ai-socratic-tutoring` | 6 | Optional diagnostics, curriculum-aware tutor, hints/targeted practice, optional cards and reassessment |
| 8 | [validate-study-plans-and-examinations-end-to-end](../../changes/validate-study-plans-and-examinations-end-to-end/proposal.md) | Specifications unchanged; `skip_specs: true` | 1–7 | Reproducible golden, regression, offline, privacy, accessibility, performance and platform evidence |

Change 2 owns the durable generation-job contract used by Changes 3 and 5. Change 3 owns question contracts used by Changes 4, 5 and 7. No later contract is imported by an earlier implementation. Diagnostic input to curriculum generation is an optional adapter added in Change 7, not a forward dependency from Change 2.

## 6. Success criteria

- All 26 user-facing objectives and all mandatory verification areas map to a change, task, test and observable acceptance criterion in [06-TRACEABILITY-MATRIX.md](06-TRACEABILITY-MATRIX.md).
- The 30-step controlled operating-systems scenario in [07-GOLDEN-SCENARIO.md](07-GOLDEN-SCENARIO.md) passes using deterministic fixtures and fake providers for ordinary verification.
- Generated content never reaches Ready or an attempt until schema, gradeability, quota and live-source validation succeed or the user explicitly accepts a disclosed question shortfall.
- Closing the application never loses a confirmed response, committed question revision, grading history, published plan version, or completed generation checkpoint.
- No exam/evidence path calls `submit_review`, modifies scheduling columns or Queue priority, or persists exam questions as `learning_items`.
- Saved plans, exams, attempts and reports work offline. No AI request occurs without the existing feature/provider/destination/cost/exclusion checks.
- All advertised actions are reachable from native desktop/mobile UI, keyboard accessible, reduced-motion aware and explicit when evidence or capability is insufficient.

## 7. Non-goals

- Psychometrically calibrated or scientifically validated “percent mastery”.
- Cryptographic answer secrecy from a user who controls their own device/database.
- Adaptive replacement of questions inside a fixed examination, automated FSRS ratings, queue reprioritization, or automatic card creation.
- A second document index, source store, tutor, provider router, flashcard store, general job server, or graph database.
- Full-library exhaustive curriculum coverage claims; bounded retrieval reports omissions and index completeness.
- Automatic background cloud work or provider retry that changes destination without consent.
- Two-way sync EntityType expansion, legacy app-state JSON export, and PWA durable implementations in this program. Whole-SQLite backup applies; unsupported paths are disclosed rather than implied.
- Copying LearnHarness code/prompts or importing its AGPL implementation.

## 8. Planning-document index

- [01-ARCHITECTURE.md](01-ARCHITECTURE.md): components, flows, lifecycle, security and failure semantics.
- [02-SHARED-CONTRACTS.md](02-SHARED-CONTRACTS.md): normative ids, TS/Rust/SQL contracts, algorithms and errors.
- [03-IMPLEMENTATION-DEPENDENCIES.md](03-IMPLEMENTATION-DEPENDENCIES.md): DAG, ownership and integration gates.
- [04-DATA-AND-MIGRATION-PLAN.md](04-DATA-AND-MIGRATION-PLAN.md): tables, migrations, deletion, backup and compatibility.
- [05-UX-SPECIFICATION.md](05-UX-SPECIFICATION.md): reachable screens and all interaction states.
- [06-TRACEABILITY-MATRIX.md](06-TRACEABILITY-MATRIX.md): requirements-to-tests mapping.
- [07-GOLDEN-SCENARIO.md](07-GOLDEN-SCENARIO.md): end-to-end fixture and 30 acceptance steps.
- [08-RISK-REGISTER.md](08-RISK-REGISTER.md): mitigations and verification.
- [09-IMPLEMENTATION-HANDOFF.md](09-IMPLEMENTATION-HANDOFF.md): exact execution playbook and reusable prompt.
- [10-ARCHITECTURAL-DECISIONS.md](10-ARCHITECTURAL-DECISIONS.md): closed decisions and alternatives.
- [11-RUN-B-VALIDATION.md](11-RUN-B-VALIDATION.md): actual validation commands/results and architect/implementer/user review.

## 9. Verified Run A corrections

Run A remains the primary evidence base, but these material corrections are normative for this program:

1. Plethora has single-select MCQ flashcard authoring/rendering and deterministic review predicates. They are not exam infrastructure; audit/reuse suitable patterns rather than claiming all MCQ/deterministic grading is absent.
2. `AnswerAssessment` rejects out-of-range values; it does not clamp them.
3. `LlmRequestPolicy` contains token budgets, not consent. Destination/privacy/cost/document gates are separate orchestration responsibilities.
4. The learning agent is production-wired through `AssistantPanel`; its small budgets and draft-only tools still make it unsuitable as the exam artifact engine.
5. Persisted domain-specific job patterns exist, but there is no ready general AI worker. The new narrow job ledger follows transcription lease and session-analysis checkpoint precedents.
6. Coverage results are transient. Declared `staleSource`/`removedSource` strings are not proof of persistent invalidation, and graph orphan-marking is specified rather than generally implemented. Study evidence requires its own live validation and deletion handling.
7. `CardSourceReference` parsing is shallow, its fingerprint is not checked by ordinary navigation, and bare chunk ids are content-sensitive cache identities. New study references therefore persist verified excerpts/revisions and re-resolve on navigation.
8. Local video does not consume generic `initialJump`; video-extract navigation must use `focusedVideoExtractId`. PDF/EPUB/audio/YouTube use their existing exact locators.
9. Navigation needs `TabType`, destination, `TabRegistry`, `MainLayout`, palette, capability/mobile and i18n wiring; adding only `tabDestinations.ts` is insufficient.
10. Native backup, app-state JSON export and two-way sync are different paths. Only whole-database backup is automatic for new tables.
11. Existing `answer_assessments` has review/item ownership and a nullable integer review-result id that does not match the current text review-result id. Exam grading persistence is therefore separate while reusing the TS assessment envelope.
12. The legacy localStorage path store has additional integrity defects: node path ids are not rebound on create, reorder can drop/duplicate nodes, and dangling/cyclic prerequisites are not reported. Import is validated and idempotent rather than blindly trusted.

## 10. Run B checkpoint ledger

| Artifact group | Status | Evidence / next action |
|---|---|---|
| Run A research consumed | Complete | All eight Run A files read; targeted call-site verification performed |
| Architecture decisions and shared contracts | Complete | 00/01/02/04/10 saved; source providers/immutability/jobs/state/evidence contracts reconciled |
| Change artifacts 1–8 | Complete | Eight apply-ready proposals/designs/spec deltas with 73 unique precise tasks |
| UX, dependencies, traceability, golden scenario, risk register | Complete | 03/05/06/07/08 saved; all 26 objectives, 30 steps and 36 risks mapped |
| Handoff and final review | Complete | 09 start/recovery workflow and 11 actual validation/three-perspective review saved; eight strict individual validations pass |
| Production changes / git mutations | None | No production source modified; no commit, branch, push or PR |
