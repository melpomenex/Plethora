## Context

Change 1 supplies native plans, source refs and strict versions. Existing retrieval, concepts/coverage and task routing are production-ready, but there is no curriculum artifact generator or general persisted AI job service. Learning-agent production wiring is live, but its 12k-character transcript, 60-second deadline and small proposal cap cannot host reliable curricula. Domain-specific transcription/session/language systems supply lease/checkpoint patterns, not a ready generic worker.

Normative contracts: program `02-SHARED-CONTRACTS.md` §§1–4/10–13; `04-DATA-AND-MIGRATION-PLAN.md` §4; ADR-04/06/08/09/20.

## Goals / Non-Goals

**Goals:**

- Reproducible source-scoped curriculum batches, deterministic identity/reconciliation/DAG and explicit preview/version publication.
- Checkpoint/cancel/recover without duplicates or silent paid resume.
- Useful no-AI outline and honest sampling/material limitations.
- Isolated job ledger reusable unchanged by C3/C5.

**Non-Goals:**

- Full book exhaustive coverage, authored lesson content, a generic job framework, graph auto-writes or background cloud analysis.
- Diagnostic UI/producer, assessment generation, mastery calculation or tutor modifications.
- Copying LearnHarness Mermaid/prompt/code or using the misleading active card capability.

## Decisions

### Pipeline modules and pure preparation

A new `generation/` subtree separates:

1. `scope.ts`: validate/freeze `CurriculumGenerationRequest` and request hash.
2. `evidence.ts`: goal retrieval + confirmed concepts + per-seed retrieval; exact document filters, dedupe and source hydration; return bounded application-owned handles.
3. `merge.ts`: map topic handles to logical drafts, canonical concept/same-as reconciliation, semantic-key/tombstone/lock preservation and duplicate issues.
4. `jobs.ts`: coordinator invoking Rust job commands and task definitions; it never writes SQLite directly.
5. `rulesOutline.ts`: deterministic no-provider path.
6. Task/schema modules: model payloads, fail-closed validation and containment tests.

The coordinator takes injected `now`, provider/preflight and native adapters. The pure merge function takes existing base version plus candidate batches and returns actions/issues rather than mutating either input. C2's UI always supplies `priorEvidence:null`; only C7 can populate it. This is a supported empty contract, not an unfinished dependency.

### Retrieval and model bounds

Freeze at most 24 documents/200 extracts. Initial goal query retrieves up to 24 hits across the explicit ids. Existing confirmed concepts in scope can add up to 12 seed queries. Per-seed top k=6, two concurrent retrievals, global 96 unique hits. Each decompose task gets ≤12 hydrated refs and ≤18,000 chars. Output topic caps by depth 8/16/24 and 3–8 candidates/batch. The system reports that these bounds are sampled evidence, not exhaustive corpus analysis.

Missing lexical/index availability records coverage-v1 limitation vocabulary. Source-only allows only grounded generated nodes plus explicitly unsupported prerequisite/material-gap nodes. Source-plus-model-knowledge may include the latter with visible labels but no answer/assessment generation privilege.

### Tasks and routing

`study-curriculum-decompose` and `study-curriculum-prerequisites` are reasoning tasks with registered full twins. Both contain source/model material in untrusted blocks and return strict JSON using the shared proposal shapes. Use per-job/step `targetId` to avoid content-key coalescing collisions. Keep fallback provenance. A fallback curriculum always displays “review carefully; full-model draft”, but unlike essay grading it may be accepted explicitly after user inspection.

Study preflight composes `classifyCloudDestination`/`classifyNativeDestination`/`classifyEmbeddingDestination`, `enforceAssistantPrivacyAndConsent`, existing feature/entitlement detection and document metadata. After it resolves the selected route, `runPinnedStudyTask` invokes `runTask(route.task,{...options,provider:route.provider})`; `options.provider` mechanically suppresses runTask's automatic alternate local/cloud retry and bypasses a second route resolution, so pre-resolution applies the chosen reasoning twin while a provider failure remains only a failed step. Merge frozen route requested/served/fallback provenance with actual model/usage because runTask's provider-injected result alone reports fallbackPath none. On explicit provider change/retry, rerun all disclosure/cost gates.

### Job lifecycle and leases

Rust persists a caller-supplied UUID `creationKey`; exact Start replay with that key returns the same job in any status. A fresh user action uses a fresh creation key, while the active `(kind,targetId,requestHash)` index prevents parallel equivalent work. Request hash remains output-content identity, not a permanent ban on later re-generation/re-grading. Jobs and all planned steps persist before first inference. Claim/complete/fail enforce step ordinal, lease owner, epoch and target revision. Leases last 120 seconds and renew around model calls. Committing a step and its draft output is one transaction. `recover_interrupted_study_jobs` marks nonterminal expired process-owned work Interrupted; opening Study Plans does not resume until the user confirms.

User cancellation increments epoch and calls the coordinator AbortController. Model execution is at least once; idempotent step commit ensures output records are once. Errors are safe codes without source/model raw payloads. User Retry only processes pending/failed steps. Completed identical input returns output ref; changed input at same step is invalid_input.

### Version adaptation

Generation targets a new C1 draft based on the current head. Each checkpoint mutates only that draft. Merge rules:

- Lock/tombstone from base wins.
- Canonical concept id is first identity; confirmed same-as resolves it; otherwise deterministic semantic key.
- User-added/modified nodes are not replaced by AI. AI may attach newly validated source refs only as diff proposals in Draft.
- Removed concept matches remain excluded.
- New edges are validated globally after every batch; invalid candidates appear as issues and do not become authoritative edges.
- Accept runs C1 Publish CAS and computes diff, including lock conflicts. No new concept link is persisted/confirmed by plan acceptance.

### Rules-only outline

Use confirmed canonical concepts/source inventory to form nodes, objectives such as “Study <concept> using the linked material” (deterministic template), verified refs and only confirmed prerequisite edges mapped to included nodes. Where concept coverage is absent, one source-inventory node per selected document/extract is permitted with document/coarse refs and an explicit “source outline, not comprehensive curriculum” notice. Order by strict DAG/title/node id. No mastery start/target is synthesized.

## Risks / Trade-offs

- **Bounded sampling misses relevant material** → index/sampling limitations and unsupported nodes are displayed; never claim exhaustive coverage.
- **AI prerequisite errors** → evidence handles, DAG rejection and explicit preview; global graph unchanged.
- **No general job service** → new narrow SQLite ledger follows existing lease/checkpoint patterns, intentionally limited to three types.
- **Consent/state change on resume** → always rerun preflight; choose compliant route or leave Interrupted.
- **Draft conflict** → CAS and rebase/review rather than overwrite.

## Migration Plan

C1 must be fully green. Append the C2 job migration next, add repositories/commands/wrappers, then tasks/coordinator and UI. No data is transformed. Removing the feature cannot revert published plans; cancelling leaves valid draft/checkpoint data. App rollback treats schemaVersion 1 data as unknown tables and never silently overwrites newer payloads.
