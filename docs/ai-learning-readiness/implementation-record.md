# AI Learning completion — implementation record

Program: `openspec/planning/ai-learning-completion-program.md`.
Skill: `openspec-apply-change` / spec-driven. Tracking issue: none.
Audited baseline: `615570ff`. This record distinguishes implemented, locally
verified, and still-pending work. It is not a release claim.

## Phase 1 — shared foundations (implemented, tested)

| Contract | Implementation | Verification |
|---|---|---|
| Feature readiness (F0) | `src/lib/ai/features/types.ts`, `registry.ts`, `destinations.ts`, `probe.ts`, `useFeatureReadiness.ts`, `activation.ts` | `src/lib/ai/features/__tests__` (destinations, registry, probe, hook) — 42 tests |
| Destination classification | keyless, billable and off-device are separate; loopback is the only URL locality treated as on-device; `.local`/RFC1918/docker-bridge are off-device; generation and embeddings classified independently | `destinations.test.ts` |
| Revision-keyed probe cache | one probe per configuration revision, in-flight dedupe, late superseded results cannot win | `probe.test.ts` |
| Capability-aware Enable All | one supported-preference update; unsupported flags preserved; consent/provider/freeform/recall-mode untouched | `AIProviderSettings.activation.test.tsx` |
| Independent relationship controls | separate `aiPrerequisites` / `aiConceptLinks` rows | same component test |
| Settings reconciliation | `mergeFeaturePreferences`: absent→default, explicit false preserved, corrupt→default; persisted readiness stripped on hydration | `settingsFeatureReadiness.test.ts` |
| Feature observations (D0) | allowlisted `FeatureObservation`, bounded per-feature stage summaries, revision-aware stale/unknown, `observeFeatureStage` | `featureDiagnostics.test.ts` |
| Task instrumentation | optional `AITaskRunOptions.observation`; `runTask` records generation-stage observations; pre-aborted signals cancel before any provider work | `runTask.test.ts` |
| Redacted export | schema `ai-diagnostics-report-v1`, finite allowlists, 256 KiB default cap, no mid-string truncation | canary/cap tests |
| Fixture smoke runner | single-flight, ≤60s, consent, cancellation, no user-data mutation | `featureSmoke.test.ts` |
| Bundled smoke adapters | learn-this, library-rag, answer-assessment, extract-worthiness, learning-agent, knowledge-coverage through real orchestration with pinned, authorized routes | runner test + modal test |
| Diagnostics UI | all ten features, static/dependency/operational evidence, stages, recovery, smoke, redacted export; browser E2E covers idle → Stop → retry → export → restart-unknown | `AIDiagnosticsModal.test.tsx` + `ai-diagnostics.visual.spec.ts` |

## Change A — complete-ai-learning-agent-integration

Implemented:

- `src/lib/ai/assistant/learningAgent.ts`: frozen run envelope, destination
  preflight (generation + embedding, independent), hard deadline, frozen
  environment, D0 stage recorder.
- `agent/deadline.ts` + `agent/loop.ts`: one absolute deadline linked to Stop,
  conversation/source/flag/unmount, slow tools and final turn; no cloud
  fallback after cancel; late results suppressed.
- `agent/evidence.ts`, proposal source refs/handles, typed unavailable
  relationship seam.
- `learningAgentAcceptance.ts`: source-grouped cards/clozes, edit revalidation,
  duplicate enforcement, acceptance-key idempotency, provenance repair,
  per-proposal states and persistence-stage observations.
- `learningAgentHandoff.ts`, `AssistantPanel.tsx` explicit secondary mode,
  palette action, conversation artifact serialization, proposal review UI.
- Rust migration `128_add_learning_item_acceptance_idempotency`, narrow
  idempotency on learning-item/cloze creation, scoped text duplicate checks
  (occlusion batch behavior untouched).
- Browser/PWA parity for the four new bounded reads and
  `(acceptance_id, proposal_id)` idempotent creation, so agent runs are not
  limited to the Tauri backend for those commands.

Verified: `learningAgentScope`, `learningAgentPreflight`, `learningAgent
.integration`, `sessionContext`, `evidence`, `proposalTools`, `loopDeadline`,
`agentArtifact`, `learningAgentAcceptance`, `learningAgentObservations`,
`AssistantPanelLearningAgent`, `LearningAgentProposals`,
`learningAgentPalette`, Rust `learning_item` acceptance tests.

Known limitation: no validated concept-handle source exists in the agent
environment, so `propose_link` consumes the knowledge adapter but returns
typed unavailable and creates nothing. The browser/PWA backend now supports the
four bounded agent reads and retry-safe acceptance keys; extract-linked cloze
creation remains `desktopOnly`, matching the existing app contract.

## Change B — complete-reader-extract-worthiness-integration

Implemented:

- `src/components/viewer/passageScoring/*`: stable identity/digest, adapter
  contract, bounded controller/queue/budget, cache/dismissal, overlay, hook.
- `src/api/passage-scores.ts`, Rust command hardening and migration
  `126_add_passage_score_metadata_and_dismissals`.
- Source-specific adapters: PDF fixed/reflow/OCR-HTML, EPUB CFI, HTML,
  Markdown, plain text, saved/unsaved RSS. Mounted in `DocumentViewer`,
  `EPUBViewer` and `RSSReader`.
- Strict `>0.75` + role/action filter, accessible marker/sheet, existing
  extract/card/cloze/highlight actions, separate scope-specific remote
  authorization (default zero).
- D0 observations and cooperative slices; seeded benchmark.

Verified: `identity`, `cache`, `controller`, `adapters`, `PassageScoreOverlay`,
`readerIntegration`, `passage-scores` API, Rust `passage_scores` tests.

## Change C — complete-knowledge-relationships-and-coverage

Implemented:

- `src/api/concept-links.ts`, `concepts/coverage.ts` (`coverage-v1`),
  `concepts/relationships.ts` (cancellable owner, drafts, lifecycle,
  related-content), `schemas/conceptRelationship.ts`,
  `tasks/definitions/relationshipTask.ts`.
- Selection sheet coverage/evidence/lifecycle UI, related-content entry,
  graph concept projection, stale/deleted evidence handling.
- Rust migration `125_add_concept_link_origin_lifecycle`, endpoint/confidence/
  origin/daily-cap enforcement, transactional lifecycle, edit conflict.
- Draft-only agent relationship adapter.

Verified: `coverage`, `coverage.orchestration`, `coverage.integration`,
`relationships`, `lifecycle.integration`, `conceptRelationship`,
`concept-links`, `SelectionActionsSheet.relationships`, `conceptProjection`,
Rust concept repository/migration tests.

## Change D — diagnostics

See Phase 1. Remaining: an actual Playwright/native E2E run of the modal
(component/unit coverage exists).

## Change E — initialization

See Phase 1. Remaining: a full fresh-profile → explicit setup → restart E2E;
the component/upgrade probes are covered.

## Change F — cross-platform readiness

- `src/test/aiLearning/fixtures.ts`: 15 synthetic fixtures, 8 profiles, ten
  features; every matrix cell starts pending/unsupported.
- `src/test/aiLearning/evidence.ts` + `scripts/ai-learning-evidence.mjs`:
  commit/revision/stage/layer validation.
- `docs/ai-learning-readiness/device-protocol.md` and
  `release-blockers.md`.
- `docs/ai-learning-readiness/evidence/manifest.json`: zero records,
  `PENDING` identities.

**No physical device, native model, real-provider or measured device-resource
evidence has been recorded.** iOS/macOS/Android/Windows/Linux qualification
tasks remain unchecked; see the blocker table.

## Pre-existing repository failures

Twelve frontend tests and one Rust test fail at the audited baseline as well
(`docs/ai-learning-readiness/release-blockers.md §4`). They are unrelated to
this program and are reported separately.
