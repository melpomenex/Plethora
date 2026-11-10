# Shared Contracts — Normative Cross-Change Reference

These contracts are closed interfaces for Changes 1–8. The TypeScript is illustrative but precise: field nullability, discriminants and validation bounds are intentional. SQL persistence details are expanded in [04-DATA-AND-MIGRATION-PLAN.md](04-DATA-AND-MIGRATION-PLAN.md). New implementation paths in change tasks must import these types rather than invent parallel versions.

## 1. Global conventions

- JSON payloads have `schemaVersion: 1`; readers refuse a newer major version with `unsupported_version`. Do not silently drop fields to make a future record readable.
- SQLite column names are `snake_case`; wire DTOs use `camelCase` through Serde `rename_all = "camelCase"`; TypeScript uses the same camelCase DTO. Existing wrappers may send both Tauri naming forms, but new commands declare one canonical form.
- Time values are UTC RFC 3339 strings with milliseconds supplied by Rust. Date-only evidence grouping uses the UTC calendar date. Never use the client's locale to order timestamps.
- Scores use finite JavaScript/Rust numbers in `[0,1]` only when normalized; points have explicit `maxPoints`. Percentages are presentation only and rounded half-up to two decimals.
- `crypto` randomness, current time, model output, and array iteration order are not ordering tie-breakers. IDs are random only at initial application-owned creation and stable thereafter.
- Text limits refer to Unicode scalar values after `.trim()` unless an algorithm says otherwise. Validation refuses oversized input rather than silently cutting a learning goal, answer key, rubric or evidence excerpt.
- Arrays with set semantics (`correctOptionIds`, source ids, concept ids) are sorted by id before fingerprinting. Arrays with semantic order (plan positions, response submissions, prompt segments) retain order.
- Canonical JSON recursively sorts object keys, uses NFC strings, rejects non-finite numbers/undefined/functions, retains array order, and uses SHA-256 formatted `sha256:<64 lowercase hex>`. Rust's existing `sha2` and `uuid` crates are available. No model-provided fingerprint is trusted.

### 1.1 Identifier ownership

| Entity | Format assigned by Rust | Model-visible substitute |
|---|---|---|
| Study Plan / version / logical node | `sp_<uuid>`, `spv_<uuid>`, `spn_<uuid>` | `p1`, `v1`, `n1…n24` scoped to one generation batch |
| Study source ref | `ssr_<uuid>` | `s1…s24` scoped to input evidence handles |
| Blueprint / revision / question / question revision | `ab_`, `abr_`, `aq_`, `aqr_` + `<uuid>` | `q1…q4`, option handles `o1…o8`, criterion handles `c1…c8` |
| Attempt / response / submission / grade | `ea_`, `er_`, `ers_`, `eg_` + `<uuid>` | Never model-authored |
| Generation job | `sgj_<uuid>` | Never model-authored |
| Evidence / gap / remediation | `le_`, `lg_`, `lr_` + `<uuid>` | Concept handles resolved to existing `concepts.id` |

No command accepts a model-generated durable id as the identity of a new row. A UI/manual edit may preserve an existing app-assigned id.

### 1.2 Common results

```ts
export interface FieldIssue {
  path: string;                 // e.g. "questions[2].correctOptionIds[0]"
  code: string;                 // stable machine-readable key
  messageKey: string;           // i18n key; no source text embedded
}

export type StudyErrorCode =
  | "invalid_input" | "not_found" | "unsupported_version" | "unsupported_platform"
  | "stale_revision" | "invalid_state" | "order_conflict" | "dependency_cycle"
  | "dangling_prerequisite" | "duplicate_node" | "invalid_source" | "stale_source"
  | "missing_source" | "ambiguous_source" | "insufficient_evidence"
  | "quota_shortfall" | "uncommitted_question" | "committed_question_immutable"
  | "duplicate_submission" | "grading_unavailable" | "needs_manual_review"
  | "provider_unavailable" | "provider_capability_missing" | "privacy_denied"
  | "cost_consent_required" | "source_ai_excluded" | "source_changed"
  | "job_lease_stale" | "job_cancelled" | "invalid_model_output"
  | "model_timeout" | "storage_failed" | "cancelled" | "internal_error";

export interface StudyCommandError {
  code: StudyErrorCode;
  messageKey: string;
  retryable: boolean;
  fieldIssues?: FieldIssue[];
  details?: {
    jobId?: string; nextStepKey?: string; minPosition?: number; maxPosition?: number;
    expectedRevision?: number; actualRevision?: number;
    requested?: number; valid?: number; missingByKind?: Record<string, number>;
  };
}

export type StudyResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StudyCommandError };
```

Tauri commands may use `Result<T, StudyCommandError>` to match existing conventions; UI adapters must not convert an error into a successful default. `storage_failed` and unconfirmed saves are visibly retryable. Provider errors retain no API keys, prompts, raw responses or learner text in diagnostics.

## 2. Source scope, evidence and navigation

### 2.1 Frozen source scope

```ts
export type StudyDepth = "survey" | "foundational" | "deep";
export type KnowledgePolicy = "source-only" | "source-plus-model-knowledge";

export interface SelectedSourceScope {
  documentIds: string[];       // unique, max 24 after resolution
  extractIds: string[];        // unique, max 200
  collectionIds: string[];     // user selection inputs, not dynamic query authority
  tagIds: string[];
}

export interface ResolvedSourceDocument {
  documentId: string;
  title: string;
  sourceType: string;
  revision: string;            // contentHash, else dateModified; never blank
  revisionKind: "content-hash" | "modified-at" | "unknown";
  extractIds: string[];
  isAiExcluded: boolean;
  isLocalOnly: boolean;
}

export interface StudySourceScopeV1 {
  schemaVersion: 1;
  selected: SelectedSourceScope;
  resolvedDocuments: ResolvedSourceDocument[]; // sorted by documentId at freeze
  frozenAt: string;
  indexCompleteness: "complete" | "partial" | "unavailable";
  limitations: string[];       // coverage-v1 limitation keys plus study-specific keys
}
```

Collection/tag membership is resolved into concrete documents when a version or blueprint draft is frozen. Later membership changes do not mutate published artifacts. An empty resolved scope returns `invalid_input`. Question publication requires every evidence document to have a non-`unknown` revision. Source-plus-model-knowledge permits visibly unsupported prerequisite suggestions, but never waives the verified-source requirement for accepted exam questions.

### 2.2 Durable evidence references

```ts
import type { ExactSearchHitLocation } from "../../../types/searchHit";

export interface StudySourceRefInput {
  documentId: string;
  extractId?: string;
  excerpt: string;             // 1..1600 chars; exact live text before whitespace normalization
  excerptSha256?: string;      // recomputed by application, model value ignored
  revision?: string;           // recomputed from live source, model value ignored
  revisionKind?: "content-hash" | "modified-at" | "unknown";
  documentTitle?: string;      // snapshot refreshed from live source
  sourceType?: string;
  jump?: ExactSearchHitLocation;
  chunk?: {
    chunkId: string; ordinal: number; startOffset: number; endOffset: number;
  };
  sectionLabel?: string;
}

export interface StudySourceRefV1 extends Required<Pick<StudySourceRefInput,
  "documentId" | "excerpt" | "revision" | "documentTitle" | "sourceType">> {
  schemaVersion: 1;
  id: string;
  revisionKind: "content-hash" | "modified-at" | "unknown";
  excerptSha256: string;
  capturedAt: string;
  extractId?: string;
  jump?: ExactSearchHitLocation;
  chunk?: { chunkId: string; ordinal: number; startOffset: number; endOffset: number };
  sectionLabel?: string;
}

export interface StudySourceResolution {
  ref: StudySourceRefV1;
  status: "current" | "stale" | "missing" | "ambiguous" | "unsupported";
  navigation: "exact" | "coarse" | "unavailable";
  reasonKey?: string;
}
```

**Creation/update algorithm:** hydrate the document/extract in Rust; reject AI-excluded/unauthorized access when inference will occur; compare the supplied revision to live revision when supplied; require the exact excerpt (after only CRLF→LF normalization) in the hydrated source chunk/extract or resolve it to a unique source span; calculate excerpt SHA-256 and revision locally; strictly validate every required per-kind jump field; assign `ssr_` id; and persist the ref plus associations in the same transaction as its owner. Model source handles are resolved only against the input handle map. Unknown/forged handles make that generated item invalid.

Whitespace-normalized substring matching may locate text, but the stored `excerpt` is the exact hydrated source substring and hash. Multiple matches yield `ambiguous_source` unless a structural locator or extract id resolves one. A bare chunk id is never accepted without live text/revision hydration.

**Navigation rules:** PDF uses page number + quote/hint; EPUB requires CFI or CFI range, preferring range + quote; HTML/Markdown re-resolve quote and optional offsets; YouTube/audio use seconds + segment; local video with `extractId` opens the document with `focusedVideoExtractId` because generic local-video `initialJump` is not consumed. Extract navigation may use `focusedExtractId`; otherwise use `openDocumentAtLocation` and `chunkLocationToSearchHit`. Status `missing` preserves the report/excerpt but disables navigation and explains deletion. Stale refs can open coarsely only when the UI labels the revision mismatch.

## 3. Study Plan aggregate

```ts
export type StudyPlanStatus = "active" | "archived";
export type PlanVersionState = "draft" | "published" | "superseded";
export type NodeActivity = "not-started" | "in-progress" | "completed" | "skipped";
export type MaterialSupport = "grounded" | "unsupported" | "not-validated";

export interface StudyPlan {
  id: string;
  title: string;               // 1..120
  goal: string;                // normalizeSessionGoal; 1..200, refuse overflow
  depth: StudyDepth;
  status: StudyPlanStatus;
  currentVersionId: string | null;
  currentVersion: number;      // 0 only while initial draft exists
  draftVersionId: string | null;
  revision: number;            // increments on head/draft switch/publish; CAS token
  createdAt: string;
  updatedAt: string;
}

export interface StudyPlanNodeIdentity {
  id: string;
  planId: string;
  semanticKey: string;         // sha256 of conceptId or NFC case-folded title plus primary objective for deduplication
  createdAt: string;
}

export interface StudyPlanVersionNode {
  nodeId: string;
  title: string;               // 1..160
  summary: string;             // 0..1000; no raw HTML
  learningObjectives: string[];// 1..6, each 1..240
  conceptId: string | null;    // existing concepts.id; null is a custom/material-gap node
  conceptLabel: string;
  position: number;            // 0..includedCount-1; contiguous among included nodes
  included: boolean;           // false is a user-removal tombstone retained across drafts
  locked: boolean;             // content and relative position requested for future drafts
  userAdded: boolean;
  userModified: boolean;
  materialSupport: MaterialSupport;
  whyHere: string | null;      // bounded explanation, may be unsupported and labelled
  sourceRefIds: string[];      // max 8; grounded published node requires >=1
}

export interface PlanPrerequisite {
  prerequisiteNodeId: string;
  dependentNodeId: string;
  support: "user" | "confirmed-concept-link" | "inferred" | "unsupported";
  rationale: string | null;
  sourceRefIds: string[];      // inferred/confirmed edges require evidence; unsupported is visible
}

export interface StudyPlanVersion {
  id: string;
  planId: string;
  version: number;             // positive; unique within plan, allocated at draft creation
  state: PlanVersionState;
  baseVersionId: string | null;
  sourceScope: StudySourceScopeV1;
  nodes: StudyPlanVersionNode[];
  prerequisites: PlanPrerequisite[];
  changeSummary: PlanVersionDiff | null;
  createdBy: "user" | "ai" | "legacy-import" | "diagnostic-adaptation";
  createdAt: string;
  publishedAt: string | null;
}

export interface StudyPlanDetail {
  plan: StudyPlan;
  version: StudyPlanVersion;
  activityByNodeId: Record<string, NodeActivity>; // persisted separately; not mastery
  sourceRefs: Record<string, StudySourceResolution>;
}

export interface PlanVersionDiff {
  addedNodeIds: string[];
  removedNodeIds: string[];
  modifiedNodeIds: string[];
  reorderedNodeIds: string[];
  addedPrerequisites: Array<[string, string]>;
  removedPrerequisites: Array<[string, string]>;
  lockConflicts: Array<{ nodeId: string; previousPosition: number; actualPosition: number; reasonKey: string }>;
}
```

A grounded published node has valid source refs and at least one objective. An unsupported node has `materialSupport = "unsupported"`, no fabricated source ref, and a Find material action. A custom user node can be unsupported by explicit choice but excluded from source-only generated exam questions.

### 3.1 DAG validation and topological sequence

`orderStudyPlan(nodes, prerequisites, previousPositions?)` is pure and returns a full result or issues, never a partial “sorted” list:

1. Reject duplicate node ids, empty included-node titles/objectives, out-of-range positions, unknown node/concept/source ids, self-edges, duplicate directed edges, and edges touching `included=false` nodes.
2. Build adjacency `prerequisite → dependent` and indegree over included nodes. Reject any endpoint not in the same included version using `dangling_prerequisite`.
3. Use Kahn's algorithm with a binary heap. Heap key is `(previousPosition ?? Number.MAX_SAFE_INTEGER, NFC-title.toLocaleLowerCase("en-US"), nodeId)`. Inserting all current zero-indegree nodes and decrementing dependents gives a stable sequence.
4. If fewer than all included nodes were emitted, return `dependency_cycle`; compute the sorted remaining ids and one concrete cycle via deterministic DFS for diagnostics. Never append the cycle or ignore it.
5. On success write contiguous positions and return the ordered ids. Complexity is `O(V + E + V log V)`; maximum 24 generated nodes, manual plans maximum 100 nodes.

**Manual move:** for node `n`, the earliest valid position is after all transitive prerequisites' current positions and the latest valid position is before all transitive dependents. Compute these by temporary DAG reachability, with the selected node removed from its old slot before bounds are evaluated. A requested target outside `[earliest, latest]` returns `order_conflict` plus both bounds and does not write. A valid move is normalized to contiguous positions and marks the node user-modified.

**Regeneration/locks:** rerun Kahn with prior positions as preference. If a locked node's actual position differs, preserve its content and lock, add a lock conflict to the diff, and require explicit publication review. Lock never licenses a cycle or impossible dependency.

### 3.2 Plan transitions and transactions

- Create Plan writes plan + current draft + logical nodes + source associations atomically; `currentVersion=0` until first Publish.
- Save Draft replaces only the draft's version-node/edge/source association rows under `expectedDraftRevision` and recomputes the whole DAG/order. IDs of retained nodes remain stable. New user nodes receive ids in Rust.
- Publish checks `expectedPlanRevision`, validates all rows/source status, supersedes the old published version, publishes the draft, clears the draft pointer and increments plan revision in one transaction. Subsequent evidence/progress still refers to logical node ids.
- Start Regeneration copies the published head to a new draft and records `baseVersionId`; it does not change the published head. A second start returns `invalid_state` until the existing generation draft is accepted/cancelled.
- Archive hides the plan and pauses generation; it preserves history. Delete Plan permanently deletes plan versions/activity only; blueprint heads detach (`plan_id=NULL`). Library data and exam history remain.
- Node activity changes only through explicit user action or an activity recording adapter. `completed` can be user-declared; reading alone never sets it. Skipped/completed status affects neither DAG validity nor demonstrated mastery.

### 3.3 Curriculum generation proposal contracts

```ts
export interface CurriculumPriorEvidence {
  diagnosticAttemptId: string;
  concepts: Array<{
    conceptId: string;
    level: MasteryEvidenceLevel;
    observedMean: number | null;
    uncertainty: UncertaintyReason[];
    evidenceGroupIds: string[];
  }>;
}

export interface CurriculumGenerationRequest {
  planId: string;
  baseVersionId: string;
  sourceScope: StudySourceScopeV1;
  depth: StudyDepth;
  knowledgePolicy: KnowledgePolicy;
  rulesOnly: boolean;
  priorEvidence: CurriculumPriorEvidence | null; // C2 supports null; C7 supplies validated diagnostics
}

export interface CurriculumTopicProposal {
  handle: string;                 // batch-local n1...n24, never durable id
  title: string;
  summary: string;
  learningObjectives: string[];
  conceptName: string;
  materialSupport: "grounded" | "unsupported";
  sourceHandles: string[];        // grounded requires >=1 allowed hydrated source handle
  whyHere: string | null;
}

export interface CurriculumEdgeProposal {
  prerequisiteHandle: string;
  dependentHandle: string;
  rationale: string;
  sourceHandles: string[];
  support: "inferred" | "unsupported";
}

export interface CurriculumDecomposeBatchOutput { topics: CurriculumTopicProposal[]; }
export interface CurriculumPrerequisiteOutput { edges: CurriculumEdgeProposal[]; }
```

A generation request hash includes canonical goal/depth/knowledge policy/base version/source revision snapshot, sorted source evidence hashes, prompt contract version and optional prior-evidence diagnostic attempt id; it excludes no field that changes output. C2 does not query future exam tables: `priorEvidence` stays null through its public UI. C7 alone constructs this object from a completed diagnostic. An invalid or unfinished diagnostic is never treated as skipped; supply no prior evidence only after explicit Skip or no diagnostic selection.

Duplicate reconciliation first uses existing canonical `concepts.id`; otherwise app semantic key NFC + trim + lowercase title + primary objective. Confirmed `same-as` links may reconcile concept ids. No vector/model similarity alone merges topics. Union their validated source refs/objectives only after exact identity; contested candidates remain separate with duplicate warnings for user review.

## 4. Assessment blueprint and deterministic slots

```ts
export type AssessmentMode = "exam" | "practice" | "diagnostic";
export type QuestionKind = "single-select" | "multi-select" | "cloze" | "short-answer" | "essay";
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface AssessmentScoringPolicyV1 {
  schemaVersion: 1;
  singleSelect: "exact-option";
  multiSelect: "exact-set-all-or-nothing";
  cloze: "equal-per-blank";
  shortAnswer: "accepted-exact-then-rubric";
  essay: "analytic-rubric";
  unanswered: "zero";
  skipped: "zero";
  negativeMarking: false;
}

export interface AssessmentConfigV1 {
  schemaVersion: 1;
  mode: AssessmentMode;
  requestedCount: number;      // 1..40; diagnostic restricted to 4..12 in C7
  typeWeights: Partial<Record<QuestionKind, number>>; // nonnegative integers, total > 0
  difficultyWeights: Partial<Record<Difficulty, number>>; // total > 0
  topicTargets: Array<{ nodeId: string | null; conceptId: string | null; weight: number }>;
  timeLimitSeconds: number | null; // null or 300..14400; practice/diagnostic null in C7
  knowledgePolicy: KnowledgePolicy;
  excludedQuestionFingerprints: string[]; // app-owned; avoid repeats for a new paper
  pointsByKind: Record<QuestionKind, number>; // integer 1..20; defaults single/multi/cloze=1, short=2, essay=8
}

export interface QuotaSlot {
  slotKey: string;             // sha256 blueprintRevisionId + zero-padded slot index
  slotIndex: number;
  topicIndex: number;
  kind: QuestionKind;
  difficulty: Difficulty;
}

export interface QuotaReport {
  requested: number;
  accepted: number;
  slots: QuotaSlot[];
  deficits: Array<{ kind: QuestionKind; topicIndex: number; difficulty: Difficulty; count: number }>;
  shortfallAccepted: boolean;
  duplicateQuestionFingerprints: string[];
  validationIssues: FieldIssue[];
}
```

### 4.1 Largest-remainder allocation and slot construction

Define `allocate(total, weights, stableKeys)`:

1. Reject negative/noninteger weights or sum=0. Keep only positive-weight entries in supplied stable-key order.
2. `raw_i = total × weight_i / sumWeights`; `count_i=floor(raw_i)`.
3. Distribute `total−Σcount_i` remaining units one each by descending fractional remainder; ties use ascending stable key (`single-select`, then `multi-select`, `cloze`, `short-answer`, `essay`; difficulty 1→5; topic plan position then node/concept id).
4. Counts are integers summing exactly to total. Complexity `O(n log n)` per dimension.

Example: total 10, types weights `[5,2,3,0,0]` produce `[5,2,3,0,0]`; two equal topic weights produce `[5,5]`; difficulty weights `1:0.2, 3:0.6, 5:0.2` produce counts `{1:2,3:6,5:2}`.

Build slots independently from topic, type and difficulty remaining counts. At each `slotIndex=0..N−1`, choose from each dimension the positive-remaining entry with highest `remaining / originalCount`; ties use the stable order above; decrement each. This exactly preserves each marginal count while mixing dimensions. `slotKey` hashes blueprint revision id plus four-digit slot index. Ready publication verifies accepted questions exactly match the selected slot properties. Replacement generation reuses the same slot key and cannot create a duplicate valid id.

A validation failure leaves a slot deficit. Generation performs the initial `ceil(N/batchSize)` batches and at most the same number of explicit recovery batches (`batchSize=4` on desktop, `2` on mobile). If valid count is below requested, the blueprint becomes Needs Review with a per-cell deficit report. Nothing invents substitutes or changes requested weights. The user may edit manually, retry deficits, or tick “Accept 17 of 30” and publish the shorter paper. Starting a paper with shortfall requires `shortfallAccepted=true`; without it return `quota_shortfall`.

### 4.2 Blueprint versions

```ts
export interface AssessmentBlueprint {
  id: string;
  planId: string | null;
  title: string;
  currentRevisionId: string | null;
  lifecycle: "active" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlueprintRevision {
  id: string;
  blueprintId: string;
  revision: number;
  state: "draft" | "needs-review" | "ready" | "failed" | "cancelled";
  planVersionId: string | null;
  config: AssessmentConfigV1;
  scoring: AssessmentScoringPolicyV1;
  sourceScope: StudySourceScopeV1;
  quota: QuotaReport;
  generationJobId: string | null;
  sourceSnapshotHash: string;
  createdAt: string;
  publishedAt: string | null;
}
```

Only Ready revisions can start an attempt. Editing a Ready revision creates a new Draft based on it; the old Ready revision remains immutable and available to history/retake. Diagnostic is a mode from the start, but only Change 7 exposes diagnostic creation/adaptation. `planVersionId` is historical lineage, not a dynamic join to whichever plan is current later.

## 5. Canonical question, key and response schemas

The persistent revision DTO has common metadata plus exactly one discriminated variant. `sourceRefIds` contains application ids after handle validation; max 4 per question, at least 1 current verified primary source on publication. Prompt max 2,000 chars; explanations max 4,000; options 2–8 for single and 2–8 for multi; option text 1–500; objective strings are bounded to 6×240.

```ts
interface QuestionCommon<K extends QuestionKind> {
  schemaVersion: 1;
  kind: K;
  prompt: string;
  difficulty: Difficulty;
  learningObjectives: string[];
  sourceRefIds: string[];
  explanation: string;
  maxPoints: number;          // integer 1..20; rubric points sum/normalize to this value
  applicationLevel: "recall" | "comprehension" | "application" | "multi-step-reasoning";
  hints: string[];             // 0..3 precommitted <=500-char hints; only Practice may reveal them
}

export interface QuestionOption { id: string; text: string; }

export interface SingleSelectQuestion extends QuestionCommon<"single-select"> {
  options: QuestionOption[];
  correctOptionId: string;
}

export interface MultiSelectQuestion extends QuestionCommon<"multi-select"> {
  options: QuestionOption[];
  correctOptionIds: string[]; // unique, sorted, size >=2
}

export type ClozeSegment =
  | { kind: "text"; text: string }
  | { kind: "blank"; blankId: string };

export interface ClozeBlank {
  id: string;
  acceptedAnswers: string[];  // 1..12, each nonempty <=500; unique after normalization
  caseSensitive: boolean;     // default false; no fuzzy mode
}

export interface ClozeQuestion extends QuestionCommon<"cloze"> {
  segments: ClozeSegment[];   // >=1 blank, exactly one segment per blank id
  blanks: ClozeBlank[];
}

export interface ShortAnswerQuestion extends QuestionCommon<"short-answer"> {
  referenceAnswer: string;    // 1..8000
  keyFacts: Array<{ id: string; text: string; required: boolean }>; // 1..10
  acceptedAnswers: string[];  // deterministic full-credit alternatives, may be empty
  rubric: AnalyticRubric;
}

export interface EssayQuestion extends QuestionCommon<"essay"> {
  expectedReasoning: string;  // committed solution outline, 1..12000
  rubric: AnalyticRubric;
}

export type AssessmentQuestion =
  | SingleSelectQuestion | MultiSelectQuestion | ClozeQuestion
  | ShortAnswerQuestion | EssayQuestion;

export interface AssessmentQuestionRevision {
  id: string;
  questionId: string;
  blueprintRevisionId: string;
  revision: number;
  slotKey: string;
  fingerprint: string;
  question: AssessmentQuestion;
  validation: "draft" | "valid" | "invalid";
  committedAt: string | null;
  provider: GenerationProvenance | null;
  createdAt: string;
}
```

**Type-specific validation:**

- Every question is self-contained without depending on option order or hidden tutor history. Source-grounded explanation and answer/rubric are generated in the same proposal but validated before preview/commit.
- Single: normalized option texts are nonempty and unique; exactly one correct id resolves; multi: 2–8 correct ids all resolve and there is at least one distractor; duplicate correct ids are invalid, not silently deduped. Stable option ids never depend on shuffled display position.
- Options/distractors must be plausible from the evidence and mutually distinct without negation cues (“all of the above”, “none of the above”) or correctness-leaking descriptions. These quality warnings do not override deterministic key validity; real-model evaluation checks pedagogy.
- Cloze: segment text does not expose accepted answers; blank ids are unique and all referenced exactly once; no adjacent blank segments without separating context; every primary deletion appears verbatim in a validated source excerpt; accepted alternatives include that deletion and are all distinct after normalization. Exam segments are independent of FSRS card `clozeText`, though conversion can reuse the independently validated marker parser.
- Short: all required key facts map to rubric criteria; accepted exact alternatives are not blank; rubric is valid and committed.
- Essay: `maxPoints≥4`, 2–8 criteria, expected reasoning is nonempty, every source-grounded criterion names allowed source ids. A reasoning/presentation criterion without direct source is explicitly typed and cannot be used to smuggle in factual unsupported claims.
- Fingerprint is SHA-256 over canonical `{kind, normalized prompt, options texts, blank source deletion texts, reference/key facts, sorted concept/node targets}`; answer input is never included. Exact fingerprints are unique within a blueprint revision. New-paper near-duplicate screening uses token 3-gram Sørensen–Dice over normalized prompt+expected answer with `similarity >= 0.85` flagged for review; no semantic/model rationale can mark an unsupported question grounded.

### 5.1 Public question projection

`toPublicQuestion(revision, revealPolicy)` constructs a fresh object from whitelisted fields. Before submission in Exam/Diagnostic mode it omits `correctOptionId(s)`, all `acceptedAnswers`, `referenceAnswer`, `keyFacts`, `expectedReasoning`, rubric level descriptors/weights, hints and explanation. It includes rubric criterion titles only when the blueprint's UI policy allows transparent criteria, never the committed solution. Practice before checking uses the same hiding; after checking it may reveal explanation/reference. This is UX answer hiding, not adversarial secrecy from a user with local database access.

```ts
export type LearnerConfidence = 0 | 0.3 | 0.5 | 0.7 | 0.9 | 1;

export type AssessmentResponse =
  | { kind: "single-select"; optionId: string | null; confidence?: LearnerConfidence }
  | { kind: "multi-select"; optionIds: string[]; confidence?: LearnerConfidence }
  | { kind: "cloze"; answers: Record<string, string>; confidence?: LearnerConfidence }
  | { kind: "short-answer"; text: string; confidence?: LearnerConfidence }
  | { kind: "essay"; text: string; confidence?: LearnerConfidence };

export type ResponseMark = "unanswered" | "answered" | "skipped";
```

Validate response `kind` against question kind, option/blank ids against the pinned revision, multi-select duplicates as invalid, optional confidence against the six declared stops, and text limits (short 20,000; essay 60,000; cloze each 2,000). Unknown keys are rejected; the UI never partially persists a malformed payload.

### 5.2 AI generation proposal shapes and private-field serialization

The model receives quota slots with stable `slotKey`, kind, difficulty, topic/objective summary, evidence handles and required default points. It returns only the following local-handle shapes. Default max points injected by the application are single/multi/cloze=1, short=2, essay=8 under `assessment-scoring-v1`; manually authored items may set an integer 1–20.

```ts
interface ModelQuestionBase {
  prompt: string;
  learningObjectives: string[];
  explanation: string;
  sourceHandles: string[];
  applicationLevel: "recall" | "comprehension" | "application" | "multi-step-reasoning";
  hints: string[];             // 0..3; omitted by weak models normalizes to [] without affecting keys
}

interface ModelOption { handle: string; text: string; }
interface ModelCriterion extends Omit<RubricCriterion, "id" | "sourceRefIds"> {
  handle: string;
  sourceHandles: string[];
}

type ModelQuestion =
  | (ModelQuestionBase & {
      kind: "single-select"; options: ModelOption[]; correctOptionHandle: string;
    })
  | (ModelQuestionBase & {
      kind: "multi-select"; options: ModelOption[]; correctOptionHandles: string[];
    })
  | (ModelQuestionBase & {
      kind: "cloze"; segments: ClozeSegment[];
      blanks: Array<{ handle: string; acceptedAnswers: string[]; caseSensitive: boolean }>;
    })
  | (ModelQuestionBase & {
      kind: "short-answer"; referenceAnswer: string;
      keyFacts: Array<{ handle: string; text: string; required: boolean }>;
      acceptedAnswers: string[];
      rubric: { expectedConcepts: string[]; gradingConstraints: string[]; criteria: ModelCriterion[] };
    })
  | (ModelQuestionBase & {
      kind: "essay"; expectedReasoning: string;
      rubric: { expectedConcepts: string[]; gradingConstraints: string[]; criteria: ModelCriterion[] };
    });

export interface ModelQuestionBatch {
  schemaVersion: 1;
  questions: Array<{ slotKey: string; question: ModelQuestion }>;
}
```

The application rejects duplicate slot keys, mismatch with requested kind/difficulty, unknown slot/evidence handles, or more/fewer questions than the batch's planned candidate slots. It assigns question/option/blank/key-fact/criterion durable-local ids and translates source handles. For cloze, blank handles map to segment blank ids; criteria keyFactIds must resolve through those mappings.

`assessment_question_revisions` uses a three-part codec:
- `payload_json`: `QuestionCommon` without key data, plus prompt/options (id/text only), cloze text/blank segment structure, and no private rubric;
- `answer_key_json`: correct option(s), cloze blank accepted lists/case policy, or short reference/key facts/accepted answers/essay expected reasoning;
- `rubric_json`: full `AnalyticRubric` for short/essay, SQL NULL for all other kinds.

The codec recombines into `AssessmentQuestion` and performs the full validator on every native read. Unknown extra combinations (objective rubric, essay correctOptionId, blank without segment, etc.) are invalid. No two representations may contain conflicting answer data.

## 6. Analytic rubrics and grades

```ts
export type RubricLevel = 0 | 1 | 2 | 3 | 4;

export interface RubricCriterion {
  id: string;                  // app-assigned per question
  title: string;
  assessmentInstruction: string;
  weight: number;              // integer 1..100
  grounding: "source" | "reasoning" | "presentation";
  sourceRefIds: string[];      // required when grounding=source
  keyFactIds: string[];       // short-answer links, empty for essay if not applicable
  levels: Record<"0" | "1" | "2" | "3" | "4", string>; // all nonempty <=1000 each
}

export interface AnalyticRubric {
  schemaVersion: 1;
  criteria: RubricCriterion[]; // short 1..8, essay 2..8; unique ids/titles, total weight > 0
  expectedConcepts: string[];
  gradingConstraints: string[];// bounded; no model-authored executable instruction
}

export type CriterionJudgment =
  | {
      criterionId: string; status: "assessed"; level: RubricLevel;
      answerEvidence: string;  // exact nonempty substring of learner response
      rationale: string; missingConcepts: string[];
      misconception: string | null; sourceRefIds: string[];
    }
  | { criterionId: string; status: "not-assessable"; reason: string };

export interface RubricGradeProposal {
  schemaVersion: 1;
  criteria: CriterionJudgment[];
  assessment: import("../../../lib/ai/schemas/answerAssessment").AnswerAssessment;
  limitations: Array<"ambiguous-answer" | "insufficient-source" | "model-capability" | "non-reasoning-fallback">;
}

export interface GenerationProvenance {
  taskId: string;
  providerId: string;
  endpointLocality: "device" | "loopback" | "lan" | "remote" | "unknown";
  requestedModelClass: "fast" | "full" | "reasoning";
  servedModelClass: "fast" | "full" | "reasoning";
  fallbackPath: "none" | "cloud-fallback" | "reasoning-fallback";
  validationOutcome: string;
  baseModelName?: string;
  promptContractVersion: "study-ai-v1";
  usage?: { inputTokens?: number; outputTokens?: number; tokenLimit?: number };
}

export type CriterionResult = CriterionJudgment | {
  criterionId: string;
  status: "manual";
  level: RubricLevel;
  rationale: string | null;
};

export interface GradeRecord {
  id: string;
  responseSubmissionId: string;
  questionRevisionId: string;
  origin: "deterministic" | "ai" | "manual";
  state: "final" | "needs-review" | "failed";
  points: number | null;
  maxPoints: number;
  assessment: import("../../../lib/ai/schemas/answerAssessment").AnswerAssessment | null;
  criteria: CriterionResult[];
  provenance: GenerationProvenance | null;
  manualReason: string | null; // required for manual grade
  supersedesGradeId: string | null;
  isCurrent: boolean;
  createdAt: string;
}
```

The rubric task uses `UNTRUSTED_CONTAINMENT_CLAUSE` plus `wrapUntrustedBlock` around prompt, committed reference/rubric, source excerpts and learner answer. It receives no tools. All criterion ids must occur exactly once; unknown/duplicate/missing ids, out-of-range levels, disallowed source handles or non-substring answer evidence fail validation. `runTask`'s repair/retry does not loosen these rules.

For a fully assessed proposal:

`normalized = Σ(weight_i × level_i/4) / Σweight_i`  
`points = maxPoints × normalized`

Application code computes and stores points with full floating precision and only rounds the display to two decimals. The existing `AnswerAssessment` envelope retains feedback, missing concepts, misconception and self-reported confidence. Model `score` and `completeness` are validated but never used as exam points. A contradiction such as overall `correct` while normalized `<0.75`, or `incorrect` while normalized `>0.25`, marks the grade Needs Review with `classification-mismatch`; thresholds are coarse consistency tripwires, not pedagogical truth. Any `not-assessable` criterion, non-reasoning fallback for essay, or `ambiguous-answer` limitation likewise yields `points` calculable only as a provisional preview and a null official score until manual review.

A Manual Review accepts/corrects each criterion level with a nonempty `manualReason`; application recomputes points and appends a new current manual grade. Retrying AI creates a superseding row, preserving the old row, submission and criterion output. Manual grades are authoritative for the report; later automatic retry cannot supersede one without explicit user action.

Provider failure has two distinct durable records. If no request was sent (no provider, privacy/cost refusal, unavailable local model), only the job step records failure and the missing/pending response grade remains unresolved; no fabricated grade row is needed. If inference was attempted and then timed out/refused/failed validation, the failed-step transaction MAY append an `origin=ai,state=failed,points=null` grade with safe provenance/error. It is current only when no prior current Final/Manual grade exists; otherwise it is historical and the prior valid result remains authoritative. Retry appends/supersedes the failed/history row normally. Neither failure records learning evidence, and attempt GradingFailed can derive from failed job/missing final grades without requiring a failed grade row.

## 7. Attempt, response and practice contracts

```ts
export type AttemptStatus =
  | "in-progress" | "submitted" | "grading" | "partially-graded"
  | "complete" | "grading-failed" | "cancelled";

export interface ExamAttempt {
  id: string;
  blueprintRevisionId: string;
  mode: AssessmentMode;
  status: AttemptStatus;
  questionRevisionIds: string[]; // fixed order at Start
  revision: number;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  submissionReason: "user" | "timer" | "timer-recovered" | null;
  submissionKey: string | null;
  awardedPoints: number | null; // null while any official item score is unresolved
  maximumPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExamResponse {
  id: string;
  attemptId: string;
  questionRevisionId: string;
  draft: AssessmentResponse;
  mark: ResponseMark;
  revision: number;
  lastClientMutationId: string;
  updatedAt: string;
}

export interface ResponseSubmission {
  id: string;
  responseId: string;
  attemptId: string;
  questionRevisionId: string;
  ordinal: number;             // 1 for exam/diagnostic; incrementing practice Check rounds
  kind: "exam-final" | "practice-check";
  response: AssessmentResponse;
  mark: ResponseMark;
  hintLevel: number;            // committed practice aid used for this checked response, 0..3; exams always 0
  createdAt: string;
}
```

Draft/Ready belong to blueprint revisions, not attempts. Attempt transitions:

| From | Event | To / effect |
|---|---|---|
| none | Start(Ready) | InProgress; fixed question order, deadline and empty responses atomically created |
| InProgress | Save/Skip/Navigate | InProgress; response CAS save; navigation itself writes no attempt status |
| InProgress | Submit / timer expiration | Submitted; immutable final submissions and deterministic grades created; duplicate acknowledged idempotently |
| Submitted | Begin grading | Grading if no final item yet; Complete if all objective items final |
| Grading | One item final/needs-review | PartiallyGraded unless all final → Complete |
| Grading / PartiallyGraded | Provider failure, no active retry | GradingFailed when at least one required item failed; resumable/retryable |
| GradingFailed / PartiallyGraded | Retry or manual grade | Grading, then PartiallyGraded/Complete |
| Complete | Explicit user re-grade | Status and prior current result remain Complete while a separate grading job runs; an authorized accepted new Final grade updates history/aggregate atomically, Manual remains protected |
| InProgress | Cancel | Cancelled; retained read-only response history; does not submit or evidence-grade |
| any terminal | Review | Status unchanged |

No transition from Submitted/Grading back to InProgress in Exam/Diagnostic. Practice remains InProgress through repeated checks and can be Finished through Submit. Practice Finish flushes every current response; for each response it reuses the latest practice-check when canonical payload/mark/hintLevel are identical, otherwise appends the next practice-check ordinal. It then persists applicable grades and derives terminal status normally. A repeated Finish/submission key is idempotent and does not duplicate evidence for an unchanged already-checked response. Every new check creates an immutable response submission and evidence-bearing grade. Exam/diagnostic allow exactly one final submission per response and no hints/correctness reveal before final submission. Practice permits immediate feedback, explanations, hints and repeated response submissions. Practice time limit is always null. Diagnostic has no feedback until submission and contributes evidence only after final grade.

Saving uses `(attemptId, responseId, expectedResponseRevision, lastClientMutationId)`. Same mutation id + identical canonical payload returns the saved row without incrementing; same id + different payload is `invalid_input`; stale revision is `stale_revision`. Submit supplies `expectedAttemptRevision` and a unique `submissionKey`. Repeating the same key for the same attempt returns the original result; a new key on an already submitted attempt returns current state without creating submissions or grades and reports `duplicate_submission` as an informational no-op.

The timer derives from `deadlineAt`, never counting intervals in the DB. Expiry when hidden/closed is reconciled on next open using the last confirmed responses. UI saves are debounced at 300 ms and flushed on navigation/blur/visibility/mobile suspension; only acknowledged saves are claimed durable.

### 7.1 Objective grading

- **Single:** one matching option id → maxPoints; otherwise 0.
- **Multi:** sorted-set equality, no duplicates, all correct and no incorrect selections → maxPoints; otherwise 0. UI discloses all-or-nothing.
- **Cloze normalization:** NFC→NFKC, trim, collapse all whitespace to one ASCII space, and Unicode lowercase when `caseSensitive=false`. Do not strip punctuation/diacritics or apply fuzzy edit distance. Each blank earns `maxPoints / blankCount` if the response exactly equals any normalized accepted alternative; absent/blank answers earn 0 for that blank. Classification is Correct if all, Partial if at least one, Incorrect if none; skipped/unanswered is its distinct outcome with zero.
- **Short:** a nonblank exact normalized match against `acceptedAnswers` can earn full points deterministically. All other nonblank answers require rubric AI/manual grading. Blank/skipped is zero without a model.
- **Essay:** blank/skipped is zero without a model; otherwise analytic rubric/manual grading.
- **Aggregate:** sum official item points only when all required items have final grades; `awardedPoints` remains null for pending/failed/needs-review. A separate provisional sum may be labelled in UI but never replaces historical final results.

## 8. Learning evidence, gaps and history

```ts
export type EvidenceSourceKind = "exam-final" | "practice-check" | "diagnostic-final" | "review-result";
export type EvidencePolicyVersion = "evidence-v1";

export interface LearningEvidence {
  id: string;
  conceptId: string;
  conceptLabel: string;         // preserve label if concept is deleted
  planId: string | null;
  nodeId: string | null;
  sourceKind: EvidenceSourceKind;
  sourceId: string;             // response submission id, or review result id for read-only import
  gradeId: string | null;
  evidenceGroupId: string;      // attemptId + conceptId, or review session + conceptId
  questionFingerprint: string | null;
  observedScore: number | null; // final normalized item score; null for activity-only/review lapse
  outcome: "correct" | "partial" | "incorrect" | "misconception" | "unanswered" | "skipped" | "review-lapse";
  misconception: string | null;
  learnerConfidence: number | null; // optional stated confidence, not calibrated model confidence
  hintLevel: number;            // 0 no hints
  graderOrigin: "deterministic" | "ai" | "manual" | "user-review";
  occurredAt: string;
  policyVersion: EvidencePolicyVersion;
}

export type MasteryEvidenceLevel =
  | "insufficient-evidence" | "needs-attention" | "developing" | "demonstrated-consistently";

export type UncertaintyReason =
  | "no-assessment" | "one-independent-session" | "few-independent-sessions"
  | "same-question-repetition" | "hints-used" | "ai-graded" | "conflicting-outcomes"
  | "stale-evidence" | "narrow-difficulty" | "source-missing" | "not-enough-recent-success"
  | "low-learner-confidence" | "high-confidence-error";

export interface ConceptMasterySummary {
  conceptId: string;
  level: MasteryEvidenceLevel;
  observedMean: number | null;  // weighted observed performance; NOT a probability of mastery
  evidenceWeight: number;
  independentSessions: number;
  distinctDays: number;
  minimumObserved: number | null;
  maximumObserved: number | null;
  latestEvidenceAt: string | null;
  uncertainty: UncertaintyReason[];
  evidenceIds: string[];
  policyVersion: EvidencePolicyVersion;
}
```

### 8.1 `evidence-v1` deterministic aggregation

Only final assessment grades produce performance evidence. `answer_assessments`, reading history, coverage level, model confidence and AI rationale are not mastery inputs. Review results are separate lapse/activity evidence. One response submission contributes to each linked concept with unique `(sourceKind, sourceId, conceptId)`; if a later grade supersedes it, update the existing evidence row transactionally and mark the adjustment in the grade history rather than double-counting.

1. Group assessment evidence by `(conceptId, evidenceGroupId, UTC date)`. Within a group, `groupScore = arithmetic mean(observedScore)` and `groupWeight` uses the most conservative (smallest) base weight among members.
2. Base weight: final exam/diagnostic 1.0; practice without hints 0.75; practice with hints 0.5. Multiply deterministic/manual grades by 1.0 and AI grades by 0.75. Unanswered/skipped remain outcomes and have observedScore=0 only for the submitted item; a completely blank diagnostic does not advance evidence level beyond insufficient.
3. Recency multiplier is `0.5^(ageDays/90)` using whole UTC days at computation time, clamped age≥0. Same fingerprint seen in an earlier distinct group gets an additional 0.25 multiplier. This is a transparent policy weight, **not** an effective statistically independent sample size.
4. `observedMean = Σ(groupScore × groupWeight × recency × repeat) / Σ(weights)` when total weight>0, otherwise null. `evidenceWeight` is that denominator round-trip calculated without early rounding.
5. `independentSessions` counts distinct attempt/session ids; `distinctDays` counts distinct UTC days. Repeated same-paper answers do not increase independent-session count beyond actual attempts but incur repeat weighting.
6. `insufficient-evidence` if no scored assessment, all-blank evidence, or fewer than 2 independent sessions; `needs-attention` if there are ≥2 independent sessions and either latest two independent groups both score<0.6, an unresolved latest misconception exists, or observedMean<0.6; `demonstrated-consistently` requires ≥3 independent sessions, ≥2 UTC days, ≥3 distinct question fingerprints, each of the latest three independent groups ≥0.8, no unresolved latest misconception and at least one deterministic/manual group; otherwise `developing`.
7. Add all applicable uncertainty reasons. Less than 3 sessions adds `few-independent-sessions`; any same-question penalty adds `same-question-repetition`; any AI/hint weight adds its reason; min/max differ by ≥0.4 adds `conflicting-outcomes`; latest evidence older than 90 days adds `stale-evidence`; fewer than two difficulty bands adds `narrow-difficulty`; any final answer with learnerConfidence≤0.3 adds `low-learner-confidence`; a final score<0.6 with learnerConfidence≥0.9 adds `high-confidence-error`; no assessment adds `no-assessment`. Confidence is an optional learner-stated calibration signal, never model certainty or a direct multiplier. Skipped/unanswered responses clear confidence.
8. Weak-prerequisite rule identity includes the dependent node id (`weak-prerequisite-v1:<dependentNodeId>`), so two dependents never collapse into one gap. Resolve that relation gap when the dependency is removed/archived, the dependent no longer Needs Attention, or the prerequisite has a later independent group ≥0.8 with no unresolved misconception. Dependency removal does not delete underlying evidence; a subsequently restored/recreated relation receives a new evaluation. Dismissal still obeys the shared evidence-cutoff rule and can re-surface only for material later evidence. Ordered rules for other gaps: `repeatedly_failed` when the latest two independent groups score<0.6; `weak_prerequisite` when a dependent node is Needs Attention and its prerequisite also has Needs Attention/insufficient evidence; `missing_concept` only for source coverage/material absence (not user ignorance); `weak_transfer` when recall/comprehension group mean≥0.75 across ≥2 groups and application/multi-step group mean<0.6 across ≥2 groups; `read_never_reviewed` and `disconnected_cluster` use existing read/graph records on explicit local refresh. Store rule id and evidence ids with every gap. A single wrong answer alone never creates Repeated Failure or claims mastery.

Gap dismissal persists by `(conceptId, kind, ruleId)` and evidence cutoff; new evidence `sourceId` after the cutoff can re-surface only when the same rule materially changes the result. Later success resolves Repeated Failure when the latest two independent groups are ≥0.8 and no unresolved misconception remains. Once active, the gap remains Active during mixed/developing evidence until that resolution rule, user dismissal, or history deletion; merely stopping further failures does not erase the already-documented weakness. Only the trigger rule creates a new gap, while this explicit hysteresis prevents oscillation on each single outcome. Dismissal never deletes evidence.

Historical comparison uses final attempts only. Same `blueprintRevisionId` is “same paper”; its score delta is explicit as retake performance and warns about memory effects. Different papers show observed histories side by side without a claim of equivalent difficulty or causally proven improvement.

### 8.2 Gap and plan progress view contracts

```ts
export type KnowledgeGapKind =
  | "weak_prerequisite" | "missing_concept" | "repeatedly_failed"
  | "read_never_reviewed" | "disconnected_cluster" | "weak_transfer";

export interface GapEvidenceRecord {
  recordId: string;
  kind: "review_lapse" | "unreviewed_reading" | "graph_edge" | "assessment";
  description: string;
  learningEvidenceId: string | null;
  sourceRefId: string | null;
  payload: Record<string, unknown>; // bounded numeric/status metadata; no untrusted executable markup
}

export interface KnowledgeGapView {
  id: string;
  kind: KnowledgeGapKind;
  conceptId: string;
  conceptName: string;
  planId: string | null;
  nodeId: string | null;
  ruleId: string;
  status: "active" | "dismissed" | "resolved";
  evidence: GapEvidenceRecord[];
  demonstrated: ConceptMasterySummary | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  evidenceCutoff: string;
}

export interface NodeLearningProgress {
  nodeId: string;
  activity: NodeActivity;
  contentCoverage: import("../../../lib/ai/concepts/coverage").EvidenceCoverage | "not-computed";
  coverageActivity: import("../../../lib/ai/concepts/coverage").CoverageActivity | "not-computed";
  demonstrated: ConceptMasterySummary | null;
  sourceStatuses: StudySourceResolution["status"][];
}

export interface LearningEvidenceReconcileResult {
  processed: number;
  remaining: number;
  nextAfterGradeId: string | null;
  completed: boolean;
}

export interface PlanEvidenceSummary {
  planId: string;
  versionId: string;
  nodes: NodeLearningProgress[]; // no composite mastery/progress percentage
  activeGapIds: string[];
  computedAt: string;
}
```

“Missing concept” describes material/coverage absence, never an assertion that the user is ignorant. `disconnected_cluster` is a library-structure suggestion, not a demonstrated-learning failure. Review lapses are separate supporting evidence; they do not produce `observedMean` or change scheduling. Any recommendation description containing model/source text is rendered as plain text or safe Markdown, never executable instructions.

## 9. Remediation contract

```ts
export type RemediationKind =
  | "open-source" | "review-extract" | "tutor" | "targeted-practice"
  | "card-proposals" | "follow-up-exam" | "plan-adjustment";

export interface RemediationRecommendation {
  id: string;
  gapId: string;
  kind: RemediationKind;
  status: "suggested" | "accepted" | "dismissed" | "completed";
  sourceRefIds: string[];
  payload: {
    conceptId: string; nodeId?: string; planId?: string;
    objectives: string[]; misconception?: string; evidenceSummary: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

Open Source/Extract uses the stored validated ref. Tutor uses the ADR-19 scoped runtime. Targeted Practice/Follow-up Exam creates a Draft blueprint; no attempt automatically starts. Card Proposals opens the existing Learn This/agent preview and only its explicit acceptance can create real scheduled `learning_items`. Plan Adjustment creates a new draft/diff. Dismiss persists user rejection. None of these actions calls `submit_review`, writes due dates, ratings, priority or Queue membership.

### 9.1 Tutor and adaptive-practice launch context

```ts
export interface StudyTutorContext {
  planId: string;
  planVersionId: string;
  nodeId: string;
  conceptId: string | null;
  gapId: string | null;
  sourceDocumentIds: string[]; // nonempty from validated current refs; hard retrieval filter
  sourceRefIds: string[];
  objectives: string[];
  misconception: string | null;
  evidenceSummary: string;     // bounded counts/outcomes and uncertainty, not long raw history
}
```

A Study tutor host calls the unchanged `TutorSession.start({topic,material,documentTitle}, runtime, options)` with `runtime.retrieve=(query,{k})=>retrieveFromLibrary(query,{k,filters:{documentIds:sourceDocumentIds}})`. The material is bounded validated excerpts plus objectives/evidence summary. An empty/invalid sourceDocumentIds list refuses Study launch instead of falling back to global retrieval. Existing non-Study tutor hosts retain their current runtime defaults. Tutor conversation does not itself create performance evidence; checked Practice supplies it.

Diagnostic adaptation never auto-skips/declares completion. For unlocked available topics, diagnostic observedMean<0.6 assigns preference `0*10000+basePosition`, 0.6–0.8 or unknown assigns `1*10000+basePosition`, and >0.8 assigns `2*10000+basePosition`; locked nodes retain their existing lock preference. C1 strict Kahn ordering applies these values only as preference keys and prerequisites still dominate. Weak outcomes may add source-bound review objectives/diff notes; no single answer creates/removes a prerequisite or proves a gap. Applying results always creates a reviewable Draft/diff.

The next targeted Practice set follows the latest final practice group: score<0.6 decreases difficulty by 1 (minimum 1), score>0.85 with hintLevel 0 increases by 1 (maximum 5), otherwise retains difficulty. It excludes prior fingerprints for a fresh set and preserves source scope. No questions change in the current attempt; adaptation happens only when the user creates the next blueprint.

## 10. Study generation jobs

```ts
export type StudyJobKind = "curriculum" | "assessment-generation" | "exam-grading";
export type StudyJobStatus =
  | "queued" | "running" | "awaiting-review" | "interrupted"
  | "completed" | "failed" | "cancelled";

export interface StudyAiPreflight {
  providerId: string;
  generationDestination: import("../../../lib/ai/features/destinations").DestinationClassification;
  embeddingDestination: import("../../../lib/ai/features/destinations").DestinationClassification | null;
  featureAllowed: boolean;
  documentIds: string[];
  sourceExcerptCount: number;
  sendsSourceOffDevice: boolean;
  sendsAnswersOffDevice: boolean;
  billable: boolean;
  cloudDisclosureAccepted: boolean;
  costConsentAccepted: boolean;
  maximumModelCalls: number;
}

export interface StudyGenerationJob {
  id: string;
  kind: StudyJobKind;
  targetId: string;             // draft plan version / blueprint revision / attempt id
  targetRevision: number;
  requestHash: string;
  creationKey: string;            // stable user-action UUID/key; exact Start replay returns this job
  status: StudyJobStatus;
  nextStepIndex: number;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancellationEpoch: number;
  attemptCount: number;
  preflight: StudyAiPreflight;
  progress: { completed: number; total: number; labelKey: string };
  lastError: StudyCommandError | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyGenerationStep {
  jobId: string;
  stepKey: string;              // e.g. "decompose:0002", "grade:<responseSubmissionId>"
  ordinal: number;
  inputHash: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  outputRefId: string | null;   // persisted owner id, never sole storage of the payload
  safeError: StudyCommandError | null;
  completedAt: string | null;
}
```

Start validates/persists the job and planned steps before inference. The caller supplies a fresh UUID `creationKey` for a new intentional generation/re-grade action and reuses it only to reconcile an uncertain Start response. `requestHash` deduplicates currently active equivalent work but does not prevent a later explicit new job after completion. A new AI re-grade therefore uses a new creation key/job and ordered steps over the same immutable question/response/rubric revisions; it never overwrites a completed prior job or grade. Rust `claim_study_job_step` atomically checks target revision, status, cancellation epoch and lease. Only that lease owner can call `complete_study_job_step`; the completion transaction writes the artifact draft/grade, marks the step, advances checkpoint and updates job progress. Duplicate completion of the same step/input hash returns its previous output. A changed input hash for a completed step returns `invalid_input`, not a second artifact.

Cancellation increments `cancellationEpoch`, aborts the in-memory `AbortController`, and preserves completed checkpoints. A late provider response cannot commit under the old epoch/lease. A lease timeout returns work to Interrupted; restarting the app does not auto-run inference. Resume re-runs preflight, requires fresh disclosure/cost consent where applicable, and schedules only pending/failed steps. Failed individual model steps can be retried once by the user; repeated malformed output leaves the draft/job Failed with completed work intact and a specific next step.

`StudyAiPreflight.maximumModelCalls` counts provider invocations, not batches: `2 × plannedModelSteps`, allowing at most the task layer's initial call and one structured-output repair per step. Reasoning-twin routing selects an alternative task but does not add a second attempt by itself; Study coordinators disallow unapproved alternate-provider/cloud fallback. An explicit user Retry/re-grade beyond the original action is a new authorization and call bound. If `runTask` policy later permits another automatic call, this formula and tests must change before use; never under-disclose planned cost. Data sent is limited to the disclosed selected excerpts, compact topic/objective metadata, and for grading the pinned question/reference/rubric and submitted answer. There is no silent full-library upload. Provider generation and embedding destinations are checked independently. AI/source-exclusion rules apply before source preparation and again before resume/retry.

## 11. Rust command surface

These are the final logical command names and payloads. Implementation uses `#[tauri::command] async fn`, `State<Repository>`, new feature modules, explicit registration, and typed TS wrappers with `invokeCommand`. Exact command function signatures may add Tauri state/context arguments but may not weaken ids, CAS or validation.

```rust
// C1 — study plans and sources
create_study_plan(input: CreateStudyPlanInput) -> Result<StudyPlanDetail, StudyCommandError>
list_study_plans(include_archived: bool) -> Result<Vec<StudyPlanSummary>, StudyCommandError>
get_study_plan(plan_id: String, version_id: Option<String>) -> Result<StudyPlanDetail, StudyCommandError>
save_study_plan_draft(input: SaveStudyPlanDraftInput) -> Result<StudyPlanDetail, StudyCommandError>
publish_study_plan_version(plan_id: String, draft_version_id: String,
  expected_plan_revision: i64) -> Result<StudyPlanDetail, StudyCommandError>
discard_study_plan_draft(plan_id: String, expected_plan_revision: i64) -> Result<StudyPlanDetail, StudyCommandError>
set_study_plan_node_activity(plan_id: String, node_id: String, activity: NodeActivity,
  expected_plan_revision: i64) -> Result<StudyPlanDetail, StudyCommandError>
archive_study_plan(plan_id: String, expected_plan_revision: i64) -> Result<(), StudyCommandError>
delete_study_plan(plan_id: String, expected_plan_revision: i64) -> Result<(), StudyCommandError>
import_legacy_study_plans(payload: String, import_hash: String) -> Result<LegacyImportResult, StudyCommandError>
resolve_study_source_refs(input: Vec<StudySourceRefInput>) -> Result<Vec<StudySourceResolution>, StudyCommandError>

// C2 — narrow jobs; C3 and C5 reuse them unchanged
start_study_generation_job(input: StartStudyJobInput) -> Result<StudyGenerationJob, StudyCommandError>
claim_study_job_step(job_id: String, step_key: String, lease_owner: String,
  cancellation_epoch: i64) -> Result<StudyGenerationStep, StudyCommandError>
complete_study_job_step(input: CompleteStudyStepInput) -> Result<StudyJobProgress, StudyCommandError>
fail_study_job_step(input: FailStudyStepInput) -> Result<StudyJobProgress, StudyCommandError>
cancel_study_generation_job(job_id: String, cancellation_epoch: i64) -> Result<(), StudyCommandError>
resume_study_generation_job(job_id: String, preflight: StudyAiPreflight) -> Result<StudyGenerationJob, StudyCommandError>
recover_interrupted_study_jobs() -> Result<Vec<StudyGenerationJob>, StudyCommandError>
list_study_generation_jobs(target_id: Option<String>) -> Result<Vec<StudyGenerationJob>, StudyCommandError>

// C3 — drafts, question review and publication
create_assessment_blueprint(input: CreateBlueprintInput) -> Result<BlueprintDetail, StudyCommandError>
save_assessment_blueprint_draft(input: SaveBlueprintDraftInput) -> Result<BlueprintDetail, StudyCommandError>
get_assessment_blueprint_revision(revision_id: String) -> Result<BlueprintDetail, StudyCommandError>
list_assessment_blueprints(plan_id: Option<String>) -> Result<Vec<BlueprintSummary>, StudyCommandError>
upsert_assessment_question_draft(input: SaveQuestionDraftInput) -> Result<AssessmentQuestionRevision, StudyCommandError>
publish_assessment_blueprint(revision_id: String, expected_revision: i64,
  shortfall_accepted: bool) -> Result<BlueprintDetail, StudyCommandError>
discard_assessment_blueprint_draft(revision_id: String, expected_revision: i64) -> Result<(), StudyCommandError>
archive_assessment_blueprint(blueprint_id: String, expected_revision: i64) -> Result<(), StudyCommandError>
delete_unused_assessment_blueprint(blueprint_id: String, expected_revision: i64) -> Result<(), StudyCommandError>

// C4 — attempts and responses
start_exam_attempt(input: StartAttemptInput) -> Result<AttemptDetail, StudyCommandError>
get_exam_attempt(attempt_id: String) -> Result<AttemptDetail, StudyCommandError>
list_exam_attempts(input: AttemptHistoryFilter) -> Result<Vec<AttemptSummary>, StudyCommandError>
save_exam_response(input: SaveResponseInput) -> Result<ExamResponse, StudyCommandError>
submit_exam_attempt(input: SubmitAttemptInput) -> Result<AttemptDetail, StudyCommandError>
check_practice_response(input: CheckPracticeInput) -> Result<PracticeCheckResult, StudyCommandError>
cancel_exam_attempt(attempt_id: String, expected_revision: i64) -> Result<AttemptDetail, StudyCommandError>
delete_exam_history(attempt_id: String) -> Result<(), StudyCommandError>

// C5 — AI/manual rubric results and history
record_rubric_grade(input: RecordRubricGradeInput) -> Result<GradeRecord, StudyCommandError>
record_manual_grade(input: ManualGradeInput) -> Result<GradeRecord, StudyCommandError>
get_response_grade_history(response_submission_id: String) -> Result<Vec<GradeRecord>, StudyCommandError>

// C6 — deterministic evidence and user dispositions
get_concept_mastery_summary(concept_id: String) -> Result<ConceptMasterySummary, StudyCommandError>
get_diagnostic_prior_evidence(attempt_id: String) -> Result<CurriculumPriorEvidence, StudyCommandError>
get_study_plan_evidence(plan_id: String) -> Result<PlanEvidenceSummary, StudyCommandError>
list_learning_gaps(plan_id: Option<String>, include_dismissed: bool) -> Result<Vec<KnowledgeGapView>, StudyCommandError>
dismiss_learning_gap(gap_id: String, evidence_cutoff: String) -> Result<(), StudyCommandError>
refresh_local_learning_gaps(plan_id: String) -> Result<Vec<KnowledgeGapView>, StudyCommandError>
reconcile_learning_evidence(after_grade_id: Option<String>, batch_limit: i64)
  -> Result<LearningEvidenceReconcileResult, StudyCommandError>
record_remediation_disposition(recommendation_id: String,
  status: RemediationStatus) -> Result<RemediationRecommendation, StudyCommandError>
```

`submit_exam_attempt` accepts objective grade outputs computed by the shared pure TypeScript grader and validates their question revision, points range and attempt membership before committing. All response submissions and grade history are persisted in Rust. `record_rubric_grade` is called by the grading job only after output validation; never expose it as a direct model tool.

## 12. Transaction, idempotency and optimistic-concurrency matrix

| Operation | One SQLite transaction contains | Idempotency / failure behavior |
|---|---|---|
| Create Plan | Plan, draft, logical nodes, version nodes, edges, refs/associations | caller creation key optional for import; any failure returns no plan |
| Save Draft | Full draft replacement, validation/version bump, new source refs | `expectedDraftRevision`; response returned only after commit |
| Publish Plan/Blueprint | All validation status, current pointers, old-version supersede, immutability commit timestamps | expected head revision; republish same published head returns current; errors preserve draft |
| Generation step completion | Draft items/grade, step completion, output ref, next index/progress, lease release | job+step key + input hash + lease + cancellation epoch; duplicate exact ack returns previous |
| Start Attempt | Attempt, ordered revisions, all empty responses, deadline | unique active attempt per `(blueprintRevisionId, clientStartKey)`; same key returns existing |
| Save Response | Current response payload/revision/mutation id | same client mutation id exact replay returns old row |
| Submit Attempt | Status, immutable final submissions, deterministic grades, aggregate/status | attempt submission key; no duplicate grades/submissions |
| Rubric/manual grade | Append grade, supersede old current, update attempt aggregate/status | unique current grade per submission; retry never deletes submission/history |
| Evidence settlement | Current grade, evidence upsert, affected summary/gaps/remediation | unique evidence source triple; grade correction adjusts rather than duplicates |
| Permanent exam deletion | Attempt, responses, submissions, grades, evidence/remediation links; unused source refs only | no library/card/review/Queue effect |

All foreign keys and unique constraints are enabled and covered with failure-injection tests. Source refs, logical ids or job outputs must never be written outside their owning transaction. UI success toasts render only after the invoke result confirms the commit.

## 13. Trust-boundary checklist

- Imported text, extracted concepts, question/rubric drafts and learner responses are untrusted data; all model-bound instances are contained.
- Model output never supplies SQL, arbitrary tool calls, route names, file paths, provider ids, source ids, database ids or schedule fields.
- Read model output through fail-closed validators; validate source evidence against live records and exact accepted answers before Ready.
- A stored hidden key is only hidden from the ordinary taking view; make no cryptographic secrecy claim.
- Store prompt/provider/model/fallback/validation provenance, never API keys or raw provider diagnostics. Learner/source text appears only in user-owned artifact rows, not logs.
- Render generated explanations with the repository's safe assistant-content component; render learner input as text. Never introduce `dangerouslySetInnerHTML` for source/learner/model data.
- Stale lease/cancellation/revision checks occur at commit as well as before inference. A successful model response does not imply successful persistence.
