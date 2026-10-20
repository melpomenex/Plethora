# AI Learning release blockers

Evidence source: `evidence/manifest.json` (zero records at the time of writing)
and `device-protocol.md`. A blocker closes only with the listed reproduction
and passing evidence at the release commit.

## 1. Native/device qualification is incomplete (all advertised cells)

| Field | Value |
|---|---|
| Owner | release owner per platform (Android, Apple, Windows, Linux) |
| Affected cells | every matrix cell marked `P`, `L` or `O` in `device-protocol.md`; see `QUALIFICATION_MATRIX` in `src/test/aiLearning/fixtures.ts` |
| Reproducer | `npm run ai:evidence:validate` then run the ten-step protocol on the named device; append records and rerun |
| Closure | required layers present for each cell at the release commit and capability revision; otherwise the profile is explicitly disabled with passing graceful-degradation evidence |

Platform-specific sub-blockers:

- **Android**: no compatible Nano/LiteRT/ML Kit device run; missing-device and
  variable model states (downloadable, downloading, failed, unsupported
  language) unexecuted. Reproducer: `npm run tauri:android:build`, install on a
  compatible phone, run the protocol. Closure: real-device records for the
  Android profiles.
- **iOS**: no physical iPhone/iPad run. Simulator evidence is not native-model
  evidence. Reproducer: `npm run test:ios:setup`, `test:ios:smoke`,
  `tauri:ios:build:device`. Closure: real-device generation, embedding,
  schema, citation and upgrade records.
- **Windows**: no API-ready or Foundry-fallback run. Reproducer: Windows host,
  `npm run tauri:build:windows`, protocol. Closure: API-authoritative
  readiness plus real model/schema/cancel records.
- **macOS**: no Apple-native run and no independently measured macOS embedding
  path (iOS bridge installation does not prove macOS). Reproducer: macOS host,
  `npm run tauri:build:macos`, protocol. Closure: real-model and embedding
  identity records.
- **Linux desktop real provider**: no recorded Ollama/external-provider run
  with source navigation, save/readback, offline and provider-failure cases.
  Reproducer: Linux host with Ollama, protocol §3-§7. Closure:
  `desktop-real-provider` records.

## 2. Embedding identity mismatch risk (iOS)

| Field | Value |
|---|---|
| Owner | Apple native + Rust embedding backend |
| Affected | iOS semantic-index and library-rag rows |
| Reproducer | Use the iOS NaturalLanguage closure, index a fixture, read back persisted model identity/language/dimensions/version; compare with `ai_learning/embeddings_backend.rs` naming |
| Closure | vectors are stored under the actual serving identity (or the label is corrected) and a real-device retrieval test passes |

## 3. Device resource and responsiveness budgets are unmeasured

| Field | Value |
|---|---|
| Owner | platform release owners |
| Affected | all mobile/desktop profiles |
| Reproducer | protocol step 8 (30s idle, 5min reading off/on, agent run, index contention, 10 teardown cycles) with process-tree CPU/RSS and frame/input timing |
| Closure | raw measurements, units and conditions recorded per device class; reviewed budgets updated from evidence; no fabricated or copied Linux numbers |

AI Learning only proposes a target table (`device-protocol.md`); no measurement
has been recorded.

## 4. Pre-existing repository failures (not caused by this program)

These fail at the audited baseline `615570ff` as well and are tracked
separately so they cannot be mistaken for new AI Learning regressions:

| Failure | Reproducer | Status |
|---|---|---|
| `database::capture_repository::tests::filtered_library_uses_all_collections_and_omits_article_bodies` (`is_local_only` missing) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | open; concurrent recording/privacy migration workstream |
| `startupAnimation staticFrame.bootSurface` | `npx vitest run src/lib/startupAnimation/__tests__/staticFrame.test.ts` | open at baseline |
| `iosCapabilitiesDoc committed matrix` | `npx vitest run src/lib/__tests__/iosCapabilitiesDoc.test.ts` | open at baseline |
| `ocrCommands` (3 tests) | `npx vitest run src/api/__tests__/ocrCommands.test.ts` | open at baseline |
| `audioEditionIntegration` | `npx vitest run src/utils/__tests__/audioEditionIntegration.test.ts` | open at baseline |
| `cardSourceNavigation ambiguous quote` | `npx vitest run src/utils/__tests__/cardSourceNavigation.test.ts` | open at baseline |
| `brandInventory service worker cache namespace` | `npx vitest run src/__tests__/brandInventory.test.ts` | open at baseline |
| `useShareTargetDedupe` (2) | `npx vitest run src/hooks/__tests__/useShareTargetDedupe.test.ts` | open at baseline |
| `Toolbar saved queues` | `npx vitest run src/components/__tests__/Toolbar.test.tsx` | open at baseline |
| `ReviewQueueView saved queue dropdown` | `npx vitest run src/components/review/__tests__/ReviewQueueView.test.tsx` | open at baseline |

## 5. Optional relationship proposals need a concept-handle source

| Field | Value |
|---|---|
| Owner | Knowledge + Agent integration |
| Affected | `propose_link` agent tool |
| Reproducer | Run an agent request that asks for a concept relationship. The tool consumes the draft-only adapter but the run has no validated concept handles, so it returns typed unavailable and creates nothing. |
| Closure | add a validated concept-handle source (read-only concept tool) and an agent integration test that stages a draft; acceptance remains in the knowledge review UI. This is an honest limitation, not a silent failure. |

## 6. Full E2E intent-family matrix and native setup flows

| Field | Value |
|---|---|
| Owner | Agent + Initialization |
| Affected | initialization 4.1, diagnostics 5.2, verification 2.1 |
| Reproducer | Playwright/desktop flow: fresh profile → partial Enable All → explicit model setup → progress → ready → restart; six agent intent families |
| Closure | recorded E2E run at the release commit. Component/integration coverage exists, but the full native setup/restart path is not executed in this environment. |

## 7. Performance gate not measured on an idle host

| Field | Value |
|---|---|
| Owner | release/performance owner |
| Affected | repository-wide `npm run bench:check` |
| Reproducer | `npm run bench:check` on the release host with no concurrent compilation |
| Observed | Four attempts during execution produced different failing benchmark sets (semantic grading, command palette, haptic policy, tabs, kp-timeline, article import, assistant invocation, reader-speech-index, daqe, anki). Machine load averaged 6–25 from concurrent Rust compilation. Targeted runs of the changed areas measured at or below baseline. |
| Closure | one clean `npm run bench:check` at the release commit with recorded host identity. New `passageScoring/*` baselines are already recorded in `scripts/perf-baselines.json`; no existing baseline or bundle budget was relaxed. |

## 8. Remote passage-scoring authorization has no Settings surface

| Field | Value |
|---|---|
| Owner | Reader + Settings |
| Affected | `extract-worthiness` remote background scoring |
| Current behavior | Remote automatic quota is 0 by default. `grantPassageRemoteScoringAuthorization` / `revokePassageRemoteScoringAuthorization` exist with provider/source scope and a finite quota, but no Settings control exposes them, so scoring remains local-only. |
| Closure | Add an explicit Settings control with a finite quota and source scope, register catalog/coverage/search targets, and test grant/revocation. Until then the conservative local-only behavior is intentional and safe, not a silent fallback. |
