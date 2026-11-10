## Context

C1 supplies source refs/scopes/head versions; C2 supplies preflight, AI tasks pattern and durable jobs. Current Learn This/card schemas and single-select flashcards are useful precedents but cannot represent exam attempts, mixed-format keys or analytic rubrics. Exam items must never be `learning_items`, which are FSRS units and cascade with document deletion.

Normative contracts: program `02-SHARED-CONTRACTS.md` §§1–2/4–6/10–13; `04-DATA-AND-MIGRATION-PLAN.md` §5; ADR-10–13/20–21.

## Goals / Non-Goals

**Goals:**

- Durable fixed papers with exact quotas and reproducible source/question revisions.
- Gradeable mixed-format schema and precommitted, database-immutable keys/rubrics.
- Batch generation/recovery plus manual offline creator and full preview/editor.
- Source-linked multi-evidence/provenance and strict privacy/capability behavior.

**Non-Goals:**

- Attempts/responses/scoring execution (C4), AI grading (C5), mastery/detection (C6), diagnostic entry/adaptation (C7).
- FSRS/Queue behavior, automatic card production, adaptive item substitution inside an exam.
- Reuse of scheduled `learning_items` or modification of active card-quality files.
- A generic reusable conceptual rubric library or psychometric scoring model.

## Decisions

### Blueprint and question serialization

Use C3 DDL from the data plan. Blueprint heads/revisions mirror plan heads/drafts, with shared CAS semantics. Each slot has one draft question revision; invalid model candidates are logged in quota/validation issues rather than filling a stored slot. Manual edit replaces an uncommitted slot revision. Ready releases all fields through an immutable committed revision and remains unchanged if later drafts occur.

TS DTO is a discriminated union. `payload_json`, `answer_key_json`, `rubric_json` use the exact split in shared §5.2. Deserialize/recombine and validate on every native read. SQL checks cover enums/points/fingerprints/slot uniqueness; TypeScript covers rich semantic combinations. Native source refs/targets are normalized associations.

### Quota algorithm and budget

Implement the largest-remainder and rotating-largest-relative-remainder allocator in shared §4.1 as pure functions. `slotKey` binds revision+index. Stable type order is single-select, multi-select, cloze, short-answer, essay; topic order is plan position then ids; difficulty ascending. Do not use random assignment or Item's current time as tie-breakers.

Generation includes initial `ceil(N/batchSize)` plus at most the same number of recovery batches, stopping early on completion. The planned batch ceiling is `2*ceil(N/batchSize)` (4 desktop/2 mobile), while the preflight's provider-invocation ceiling is `2 * plannedBatches` to include each task's initial call and one structured-output repair. No unapproved alternate/cloud retry is included. A later explicit Retry/re-grade requires its own action budget/consent. Every batch is one durable job step. Any failed cell stays deficit. Publication requires exact requested cells or `shortfallAccepted=true`, which starts a smaller fixed paper without altering its original quota report.

### AI generation

Task input contains synthetic app-assigned slotKey, requested kind/difficulty and `pointsByKind` value (defaults single/multi/cloze=1, short=2, essay=8), targets/objectives, and ≤4 evidence batches. Output uses only model-local handles from shared §5.2, never durable source/option/criterion ids. The application maps ids/difficulty/maxPoints and validates source quote/evidence before checkpoint. It uses C2 preflight and disables undisclosed fallback.

Question fingerprint is computed locally. Exact duplicate valid fingerprints are DB-enforced per paper. Near duplicate uses normalized prompt+expected answer token 3-gram Sørensen-Dice >=0.85 across the paper and selected prior fingerprints, but similarity does not ground content. Explicit retake in C4 can reuse old fixed revision; generating a new follow-up uses the exclusion list.

### Validation and pedagogical warnings

Machine-blockers are missing/invalid keys, inconsistent discriminants, inadequate rubric/levels, unresolved evidence, invalid source excerpt or duplicate slot/fingerprint. Plausible-distractor/non-sequitur concerns that deterministic code cannot prove are review warnings/real-model evaluation concerns, not claims of semantic certainty. Source-grounding for short/essay includes the reference answer/key facts/expected reasoning and rubric factual criteria, not merely the prompt. Existing `checkCandidateGrounding` may be reused where its actual LearningCardCandidate signature fits cloze/short-answer concepts; exam union conversion belongs to the new adapter. This change does not call a future `validateGeneratedCard`.

### Manual editing and preview/publication

The builder exposes core user controls (scope/topics, count, types, difficulty, timer, exam/practice) and source-only default. Advanced repeat/provider settings are per-paper controls, not new global Settings; no Settings-search additions unless implementation puts them in Settings. Preview shows all public prompt content plus author/inspector answer keys, references, citations and rubric criteria. The learner Start projection hides answers later.

Manual question editor offers all five types and identical source validation. No provider means Generate disabled with explanation while Add Question/Publish exact manually valid paper remains. Diagnostic is a stored enum for later; C3 UI offers only exam/practice. Time limit is disabled/null for Practice.

### Transactions and deletion

Ready publication transaction rechecks scope revisions, source current state, quotas and every payload, then commits question revisions, Ready state and head pointer. Any failure leaves draft. Plan deletion later detaches blueprint via FK while preserving question/attempt history. Hard delete allowed only if no attempt references any paper revision; Archive otherwise. Update trigger protects committed content; no command provides a committed-key update route. No answer key is sent to the public taking DTO.

## Risks / Trade-offs

- **Generated wrong answer despite schema validity** → source verification/committing/editable preview and real-model evaluation; schema validity is gradeability, not factual warranty.
- **Near-duplicate heuristic misses paraphrase** → report uncertainty and test known examples, never claim semantic elimination.
- **Rubric prompt/output size** → strict 2–8 criteria, bounded batches and per-item later grading.
- **Partial recovery still falls short** → exact deficits plus manual/retry/explicit acceptance, never fabricate.
- **Ready revision multiplication** → one clone per intentional edit; old fixed papers intentionally retained for history.

## Migration Plan

After C2 gate, append C3 migration/repositories then commands/adapters; pure types/quota/validation can land first. No existing learning/card data is transformed. Ready trigger applies only new assessment tables. Browser/PWA native unsupported behavior remains as C1. Rollback does not mutate existing cards or documents; new tables can remain unused by older builds, while new JSON major versions fail closed.
