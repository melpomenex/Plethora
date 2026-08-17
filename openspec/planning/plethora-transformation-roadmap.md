# Plethora Transformation — Master Roadmap & Dependency Plan

Status: planning artifact (2026-08-17). Companion to the 24 OpenSpec change proposals under `openspec/changes/`. Product: **Plethora — Read anything. Learn everything.** Philosophy: **do not paywall reading; paywall augmentation.** The app stays local-first, offline-capable, and fully useful without an account.

## How to use this document

Each numbered proposal below matches its `openspec/changes/<name>/` directory (proposal.md / design.md / specs / tasks). Every proposal carries its own Dependencies / Shared interfaces / Ownership boundaries / Collision risks / Integration contract sections — this file is the cross-proposal map for launching multiple implementation agents.

---

## Proposal index

| # | Change | Wave | Capability | Critical path? |
|---|--------|------|------------|----------------|
| 1 | `rebrand-incrementum-to-plethora` | W0 Parity | — | **Yes** (root) |
| 2 | `establish-plethora-commercial-product-foundation` | W1 Foundation | (owns registry) | **Yes** |
| 3 | `implement-plethora-accounts-authentication-and-entitlements` | W1 Foundation | — | **Yes** |
| 4 | `implement-cross-platform-subscription-billing-and-license-management` | W1 Foundation | all (grants) | Yes (gates 23) |
| 5 | `implement-plethora-pro-cloud-service-and-usage-quota-architecture` | W1 Foundation | (owns jobs/quotas) | **Yes** |
| 6 | `implement-plethora-pro-end-to-end-encrypted-cloud-sync` | W2 Cloud | `cloud_sync` | Yes |
| 7 | `implement-plethora-intelligence-cross-library-semantic-indexing-and-rag` | W2 Intelligence | `library_intelligence` | **Yes** (intelligence root) |
| 8 | `implement-plethora-automatic-semantic-connections` | W2 Intelligence | `semantic_connections` | No |
| 9 | `implement-plethora-personal-knowledge-graph` | W2 Intelligence | `knowledge_graph` | Yes (gates 10/11) |
| 10 | `implement-plethora-knowledge-gap-detection` | W2 Intelligence | `knowledge_gap_detection` | Yes (gates 11 value) |
| 11 | `implement-plethora-ai-generated-adaptive-learning-paths` | W2 Intelligence | `adaptive_learning_paths` | No |
| 12 | `implement-plethora-teach-me-adaptive-ai-tutoring` | W2 Intelligence | `ai_tutoring` | No |
| 13 | `implement-plethora-intelligent-flashcard-generation` | W2 Intelligence | `enhanced_card_generation` | Yes (gates 14) |
| 14 | `implement-plethora-ai-flashcard-lifecycle-optimization` | W2 Intelligence | `card_optimizer` | No |
| 15 | `implement-plethora-knowledge-health-and-advanced-learning-analytics` | W2 Intelligence | `advanced_analytics` | No |
| 16 | `implement-plethora-premium-document-reconstruction-ocr-and-conversion` | W3 Cloud | `cloud_document_processing` | No |
| 17 | `implement-plethora-premium-neural-tts-and-audiobook-generation` | W3 Cloud | `premium_tts` | No |
| 18 | `implement-plethora-video-podcast-and-lecture-ingestion-and-transcription` | W3 Cloud | `transcription` | No |
| 19 | `implement-plethora-web-inbox-email-ingestion-and-remote-capture` | W3 Cloud | `web_capture` | No |
| 20 | `implement-plethora-pro-integrations-api-and-automation` | W3 Cloud | `api_access`, `automation`, `integrations` | No |
| 21 | `implement-plethora-pro-feature-discovery-upgrade-and-paywall-ux` | W4 Commercial | (consumes all) | Yes (gates 23) |
| 22 | `implement-plethora-cloud-privacy-security-data-export-and-account-deletion` | W1→W4 spanning | — | Yes (gates 23 labels) |
| 23 | `prepare-plethora-for-apple-app-store-and-google-play-commercial-release` | W4 Commercial | — | **Yes** (terminal) |
| 24 | `implement-plethora-pro-observability-cost-controls-and-cloud-performance-gates` | W1→W4 spanning | — | Parallel with cloud stack |

## Wave diagram

```text
PLETHORA PARITY (W0)
    └── 1. rebrand-incrementum-to-plethora            [strictly first; i18n/branding landmine]
          │
COMMERCIAL FOUNDATION (W1)  — 2 first (interface-first), then 3/5 parallel, 4 after 3
    ├── 2. product foundation (capability registry + entitlement store)
    ├── 3. accounts / auth / entitlements ──┐
    ├── 5. cloud service + quotas + jobs ───┤   (3 & 5 coordinate on server contracts)
    ├── 4. billing / license management ◄───┘   (needs 3 + 5)
    └── 22a. privacy interface-first milestone (local-only flag + disclosure registry)
          │
INTELLIGENCE CORE (W2a — local-first, cloud-optional)
    └── 7. library RAG / semantic indexing       [root; rag_query + RagCitation contracts]
          ├── 8. semantic connections            (parallel)
          ├── 9. personal knowledge graph        (parallel; owns concept schema)
          └── 13. intelligent card generation    (parallel; owns card pipeline)
                ├── 10. knowledge gap detection  (needs 7+9; benefits 8/13)
                └── 11. adaptive learning paths  (needs 10)
    ── 12. adaptive tutoring (needs 7; soft 9/10)   ─┐
    ── 14. card lifecycle optimization (needs 13)     ├─ run in parallel after their gates
    ── 15. knowledge health analytics (needs 10)      ┘
          │
CLOUD CAPABILITIES (W2b/W3 — after 3+5 stable; all parallel)
    ├── 6. E2E encrypted cloud sync             [critical; lessons from deleted Yjs system]
    ├── 16. premium document reconstruction
    ├── 17. premium neural TTS + audiobooks
    ├── 18. video/podcast/lecture transcription
    ├── 19. web inbox / email / remote capture
    └── 20. public API / integrations / automation
          │
COMMERCIALIZATION (W4)
    ├── 21. discovery / upgrade / paywall UX    (needs 2+3+4)
    └── 23. App Store / Play release readiness  (needs 1+4+21+22)
    ── 24. observability / cost gates spans 5→launch (cloud not "production" without it)
```

## Critical path

`1 → 2 → {3, 5} → 4 → 6 & (7 → 9 → 10 → 11) → 21 → 23`

Two parallel critical chains (cloud platform, intelligence core) converge at commercialization. 22 and 24 are spanning hardeners with early interface-first milestones (22a local-only flag; 24 emission points come from 5) and late completion milestones (deletion/labels before 23; enforcing gates before paid launch).

## What can start immediately (after 1 lands)

1. **Proposal 2** — alone, interface-first (registry types + store skeleton) unblocks 3/5.
2. Then, in parallel: **3** and **5** (after 2's milestone-1 commit), plus **22's milestone 1** (flag/disclosure registry), plus **24's metric contract work** (conventions + baselines schema).
3. **7's local tier** may start alongside W1 (no server dependency) if the team accepts coordination on `ai_learning/` + i18n; strictly it needs only rebrand + 2's gate for its cloud tier.

## What is blocked (examples)

- 8, 9, 13 → blocked on 7's `rag_query`/`RagCitation` milestone.
- 10 → blocked on 7 + 9. 11 → blocked on 10.
- 6, 16–20 → blocked on 3 + 5 (framework interfaces).
- 21 → blocked on 3 + 4. 23 → blocked on 4 + 21 + 22 (labels/deletion).
- Everything → blocked on 1 (branding collisions, especially the six locale files).

## Shared architectural interfaces (ownership map)

| Interface | Owner | Consumers |
|---|---|---|
| Capability registry + `EntitlementSnapshot`/`QuotaState` + `useCapability`/`CapabilityGate` | 2 | 3, 4, 5, 7–21 |
| `/v1/auth/*`, `GET /v1/entitlements`, device registry/keypairs, `accountStore` | 3 | 4, 5, 6, 19, 20, 21, 22 |
| `/v1/jobs` lifecycle + error envelope + rate limits, `ProviderRegistry`, `CloudJobService` (TS+Rust), quota envelopes | 5 | 6(transport-only), 7, 16–20, 24 |
| BillingProvider + `/v1/billing/*` + grants derivation | 4 | 21, 23 |
| Sync record model + `/v1/sync/*` + `SyncEngine` + crypto epochs | 6 | 19 (inbox delivery), 22 (deletion of ciphertext) |
| `rag_query` + `RagCitation` + `source_kind` + `CitationChips` + `embed_batch` kind | 7 | 8, 9, 10, 11, 12, 13 |
| `concepts`/`concept_links` schema + graph queries (`neighborhood`/`path`) | 9 | 8 (writes via commands), 10, 11, 15 |
| `generateCards`/`CardProposal` + duplicate primitives + card provenance (`source_ref`) | 13 | 10, 11, 12, 14 |
| Gap records + mastery estimates (`list_gaps`, `knowledge_health/gaps.rs`) | 10 | 11, 12, 15, 20 (events) |
| `knowledge_health_daily` rollups + Analytics shell | 15 | 10/14 mount modules |
| Canonical reflow schema (additive versions) | pdf reflow subsystem | 16 (cloud producer), 17 (canonical text) |
| TTS provider registry interface | existing `src/api/tts/` | 17 (additive adapter) |
| `transcript_segments` schema + transcription queue | 18 (additive speaker col) | — |
| Article-extraction isomorphic module + `/v1/capture/*` + inbox | 19 | 20 (API surface), extension |
| API token/scopes + webhook event catalog + `/v1/api/*` | 20 | 19 (capture:write), 23 |
| Local-only flag (`isCloudEligible`) + disclosure registry + deletion/export contracts + audit log | 22 | 7, 16–20 (enforcement), 23 (labels) |
| Store build variants + release checklist + versionCode automation | 23 | release process |
| Metric conventions + `cloud-perf-baselines.json` + alert rules | 24 | CI, ops |

## Likely code ownership collisions (top risks + mitigations)

| File / area | Contended by | Mitigation |
|---|---|---|
| `src/lib/i18n/locales/*.ts` (6 files) | every proposal | 1 lands first, strictly; thereafter append-only key sections per proposal (`monetization.*`, `connections.*`, …); CI key-parity check |
| `src-tauri/src/lib.rs` registration block | every Rust-touching proposal | one focused "register commands" commit per proposal; no drive-by edits |
| `src-tauri/src/database/migrations.rs` (inline MIGRATIONS array) | 6, 7, 9, 11, 14, 15, 17, 18 | **re-anchor rule**: task numbers are expectations; at implementation take the next free number in array order; names must be unique |
| `server/src/{index.ts,db/schema.ts,middleware}` | 3, 4, 5, 19, 20, 22 | route-file-per-proposal; 5 owns middleware order; contract-first commits |
| `src/stores/settingsStore.ts` + `src/types/settings.ts` | 2, 7, 8, 10, 17, 22 | additive subtrees only (`plethora.*`, `embedding`, `connections`, …); settings version bump coordinated once per wave |
| `src/components/viewer/DocumentViewer.tsx` chrome | 8 (margin affordance), 12 (selection chip) | additive mount points; no internal refactors by either |
| `src/components/settings/UserProfilePanel.tsx` | 3 (structure), 21 (upgrade panel) | 3 first, 21 replaces only the upgrade stub section |
| `AnalyticsPage`/dashboard mounts | 10, 11, 15 | 15 owns shell; 10/14 mount modules per contract |
| `concept_repository.rs` / concept commands | 8 (producer), 9 (owner) | 9 owns schema; 8 only calls existing propose/accept commands |
| `FlashcardStudioModal.tsx` | 13 (owner this wave) | 14/15 must not touch; file is huge — single-owner discipline |
| `src/api/tts/registry.ts` | 17 (additive adapter) | additive file; catalog logic shared additively |
| `src/utils/articleImport/` | 19 (isomorphic refactor) | one atomic behavior-preserving move with golden-test parity |
| CI workflows | 23, 24, 1 | additive jobs; 1 renames happen before others add |

## Recommended branch strategy

The repo convention is commit-to-`main` (AGENTS.md). For parallel agents, use **short-lived integration branches** (`plethora/w1-accounts`, `plethora/w2-rag`, …) merged to `main` in dependency order, each passing full gates (`npm run test:run`, `cargo test --lib`, `npm run bench:check`, `npm run build:check`) before merge. Interface-first milestones (marked in tasks as section 1) merge to `main` **immediately** so dependent proposals branch from real contracts, not copies. One proposal = one branch = one OpenSpec change; no cross-proposal drive-by changes (spec Non-goals enforce).

## Recommended integration order (merge sequence)

1. `1` (rebrand) → main.
2. `2` milestone 1 (types/registry/store skeleton) → main; then `3`+`5` branches cut simultaneously; `22` milestone 1 rides with `5`.
3. `5` framework milestone → main → cut `6`, `16`, `17`, `18`, `19`, `20` branches (19's extension work waits for 20's token contract only at its final task).
4. `3` complete → main → `4` branch; `7` branch (local tier) any time after 2.
5. `7` milestone 1 (`rag_query`+citations) → main → cut `8`, `9`, `13`.
6. `9` + `13` milestones → main → cut `10` (needs 7+9); `12` (needs 7) anytime after 5.
7. `10` → main → `11`; `14` after `13`; `15` after `10` (shell can land earlier).
8. `4` → main → `21`.
9. `22` completion (deletion/labels) + `21` → `23` readiness program.
10. `24` enforces cloud gates once baselines exist from reference runs (before any paid launch).

## Architecture decisions that changed vs. the original product brief

1. **Sync is greenfield, not an extension**: the Yjs realtime sync subsystem was deleted (Aug 2026) after 15+ GB memory failures; proposal 6 builds a bounded record-delta engine instead, explicitly avoiding CRDTs — informed by five archived/legacy proposals' lessons.
2. **RAG/semantic indexing largely exists** (`ai_learning`, migration 085, on-device EmbeddingGemma, FTS5+cosine retrieval): proposal 7 extends coverage/citations/fusion rather than building anew.
3. **Knowledge-graph backend exists unpopulated** (`concepts`/`concept_links` + accept/dismiss workflow): proposal 9 is "wire up + extract + visualize", and owns the schema others (8) write through.
4. **Auth partially exists** (JWT server, login modal, `subscription_tier` column): proposal 3 evolves rather than replaces; server gains refresh rotation + device registry.
5. **Billing is greenfield**; plugin precedent (`incrementum-android-genai`) defines the native-store plugin pattern (`plethora-storekit`, `plethora-playbilling`).
6. **Local automation API + MCP already exist** (localhost automation endpoints with rotatable keys; ~20 MCP tools): proposal 20 extends both and adds the cloud tier — no third mechanism invented.
7. **Free tier is stronger than typical**: all local AI/TTS/transcription, BYO-key everything, local backups stay Free; Pro = Plethora-hosted compute/sync/storage only — encoded structurally via capability fallbacks + invariant tests (reading/review never consult entitlements).
8. **Rebrand is two-phase** with a documented retained-legacy list (`BRANDING.md`) — the updater chain, Obsidian `incrementum-id`, `.incrementum` backups, and keychain read-throughs are compatibility surfaces later proposals must not "clean up".
9. **Licensing**: repo is Apache-2.0 (no CLA) — no license change made; new proprietary code segregation is flagged for legal review (proposals 1/2 open questions), not decided in specs.

## Standing rules for all implementation agents

- Migration numbers in tasks are **expectations**; re-anchor to the next free slot in the `MIGRATIONS` array at merge time (array order is authoritative, names unique).
- Any intentional perf change updates `scripts/perf-baselines.json` (and, once live, `cloud-perf-baselines.json`) in the same change (AGENTS.md protocol).
- i18n: every user-facing string lands in all six locales in the same change (append-only sections).
- Cloud paths must register into 22's disclosure registry and respect `isCloudEligible`; content never appears in logs/metrics/webhooks.
- Calm-UX invariants: no monetization, connection, or gap surfaces inside reading/review flows (invariant tests are part of 2/8/10/21).
- Each proposal's `tasks.md` section 1 is its interface-first milestone — merge those before branching dependents.
