# Issue #6 verification and release evidence

## Planning runs on 739802ae

| Command or check | Observed result | Boundary |
| --- | --- | --- |
| `gh api repos/melpomenex/Plethora/issues/6`, paginated comments and timeline | Open, both comments and 29 retrievable attachments, historical plan commit linked | Issue evidence |
| Source-derived fixed-clock Deck Manager helper run with `TZ=UTC` | Due at 09:01, inspected 09:08, returns `{"text":"Overdue","urgent":true}` | Deterministic reproduction of production helper, not a native screen run |
| `npm run test:run -- --reporter=dot` | 9,877 passed, 50 failed, 5 skipped across 24 failing files, including one suite that failed before tests could run | Full baseline failure |
| Focused Issue #6, Assistant, DocumentsView, selection, Study Plans and platform-capability Vitest run | 52 passed, 18 failed. Assistant integration passed in this rerun | Unit/integration fixtures |
| Focused video playback/rating, playlist, review renderer, extract editor/Q&A and browser acceptance suites | 42 passed, 3 failed across browser mocks. Six surface suites passed | Unit/component and browser adapter fixtures |
| `npm run test:visual -- issue6-assistant-scroll.visual.spec.ts` | Initial browser unavailable. After `npx playwright install chromium`, 3/3 passed | Chromium fixtures and Assistant host, native webviews outstanding |
| `npx playwright test --list` | 246 tests in 28 files. Study Plans golden file excluded | Discovery |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib video_extract -- --test-threads=1` | Dependency build killed by SIGKILL compiling `ring`; no tests executed | Build/environment failure |
| Native full, production builds, benchmark gate, lint, full visual, physical devices, external models and restricted account media | Pending | Implementation and release |

Focused rerun command:

```bash
npx vitest run src/test/issue6 \
  src/components/assistant/__tests__/AssistantPanelLearningAgent.integration.test.tsx \
  src/components/documents/__tests__/DocumentsView.test.tsx \
  src/components/viewer/selectionInteraction/__tests__/selectionActionRegistry.test.ts \
  src/lib/study-plans/assessments/__tests__/{blueprintService,generationCoordinator}.test.ts \
  src/lib/__tests__/platformCapabilityLint.test.ts
```

Surface rerun command:

```bash
npx vitest run src/hooks/useVideoExtractPlayback.test.tsx \
  src/components/__tests__/VideoExtracts.rating.test.tsx \
  src/components/media/__tests__/YouTubePlaylistManager.persistence.test.tsx \
  src/components/review/__tests__/ReviewCardContent.parity.test.tsx \
  src/components/extracts/__tests__/{QACreatorPopup,ExtractContentEditor}.test.tsx \
  src/lib/__tests__/{browserBackendExtractGeneration,browserBackendLearningAgent}.test.ts
```

To reproduce the same-day defect without native setup, extract the current `relativeDueDate` function from `DeckManagerCardRow.tsx`, transpile with the workspace TypeScript compiler, and call it with a Date fixture returning UTC 09:08 at evaluation and due UTC 09:01 on the same date. Candidate coverage should run the public UI with the fixed clock and persisted card.

## Baseline failure register

| Cluster | Failures | Classification and action |
| --- | ---: | --- |
| `rankingParity.test.ts`, `DocumentsView.test.tsx` | 6 | Reproduced focused. Ranking assertions differ on future/new, explicit zero and recall inputs. Priority tests open the modal but their commit spies are never called. Verify the current popup commit contract and actual write before classifying it as a product failure. |
| `generationToAcceptance.test.ts`, `AssistantPanelLearningAgent.integration.test.tsx` | 2 | Zero provider requests reproduces in both runs. Missing save action in full-suite only. Inspect fixtures, provider dispatch and timeout with identical isolation before changing expectations. |
| `browserBackendExtractGeneration.test.ts`, `browserBackendLearningAgent.test.ts` | 3 | Reproduced focused. One stale call arity and two missing database mock exports. Preserve assertions and add actual IndexedDB write/retry coverage. |
| `selectionActionRegistry.test.ts`, `rssSelectionMenu.test.tsx` | 5 | Four reproduced focused. Menu order/descriptor drift, one RSS assertion needs isolated rerun. AI/Extract owners coordinate registry expectations. |
| `platformCapabilityLint.test.ts` | 4 | Reproduced focused. Study Plans tab, mobile entry and commands lack declared coverage. C1/C8 track. |
| `blueprintService.test.ts`, `generationCoordinator.test.ts` | 3 | Reproduced focused. Normalized detail shape, missing revision fields in fake data and retry step-count divergence. C3 verifies actual serialized contract. |
| `AudiobooksTab.test.tsx` | 13 | Full-run DOM/state failures. Reproduce on clean isolated baseline and inspect queue/media adjacency before excluding. |
| `articleImport/renderedFallback.test.ts` | 2 | Full-run timeouts. Re-run with Chromium now installed, distinguish driver/network/setup from application defect. |
| `ocrCommands.test.ts`, `noNativeDialogs.test.ts`, `Toolbar.test.tsx` | 5 | Full-run boundary assertions. Isolate before deciding relation to reader workflows. |
| `brandInventory.test.ts`, `registry.test.tsx`, `iosCapabilitiesDoc.test.ts`, `i18n-completeness.test.ts`, `labelMapping.test.ts`, `staticFrame.test.ts`, `inventory.test.ts` | 7 | Baseline inventory, documentation, navigation or token assertions. Check Study Plans/Settings/reader relevance and retry separately. |
| `listenLaterStore.test.ts` | 1 suite | Suite collection failed at the audio-generation store subscription because the imported mock lacks subscribe. Separate from the 50 failed test assertions. |

Treat other dated baseline failures in the historical video and Study Plans reports as leads. Repeat relevant Rust/bench suites on the delivered SHA before accepting a historical classification.

## Release commands and matrix

1. Run `openspec validate --type change --strict --no-interactive <change-id>` for each owner and C1–C8 and run `openspec validate --all --strict --no-interactive`. Compare known repository-wide failures to the baseline snapshot. Check delta heading/ownership, scenario syntax, link targets and DAG.
2. Run `npx tsc --noEmit`, `npm run lint`, `npm run test:run`, `npm run test:scripts`, `npm run docs:validate`, `npm run docs:coverage`, `npm run build:check`, applicable `npm run build:tauri` and `npm run build:pwa`, plus `npm run bench:check` after production build. Log budget sizes and relative benchmark results, with rationale for intentional baseline updates. GitHub Actions is supplemental evidence.
3. Run `cargo fmt --manifest-path src-tauri/Cargo.toml --check` and `RUST_MIN_STACK=33554432 cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`, plus applicable integration tests. Use a conservative build job limit if the host cannot complete dependency compilation. Exercise migrated populated DB, rollback, foreign keys, exact before/after state and whole-DB backup/restore.
4. Run `npm run test:visual` and the explicit C8 E2E configuration created by its owner. Use screenshot-derived synthetic fixtures, 390/768/1360 px and 1512×982 comparison where relevant, light/dark and 200% zoom. Verify keyboard, touch, focus restoration, accessible names/status and contrast. For real SQLite evidence, drive production Tauri IPC on a temp profile; for IndexedDB, close and reopen the browser context with its persisted storage.
5. Qualify Linux WebKitGTK, macOS WKWebView, Windows WebView2, Android and iOS for each advertised route. Record version/device, restart or suspend/resume and accessibility. Use offline and authenticated native media cases. Browser/PWA needs a real persistence cycle where supported and explicit unavailable UI where unsupported. Record skipped rows with the remaining advertised-scope blocker.
6. Run scripted provider fault cases with no external egress. Separately qualify at least one authorized real local and one explicitly approved remote provider using synthetic content, exact selected and actual model, embedding route where applicable, cost/usage, source scope, malformed/empty/refusal/cancel/disconnect and no unauthorized fallback. Do not treat a live-provider pass as deterministic correctness.

The release evidence ledger has one row per ID and applicable platform, with build SHA, fixture, exact command or manual steps, expected/observed result, artifact, outcome and residual limitation. Confirm every P1 row and all advertised platforms. Require agreement for deferred P2/P3 scope. Complete the issue-facing draft with evidence links only after the ledger clears.

## OpenSpec validation at planning handoff

OpenSpec 1.13.0 passes strict noninteractive validation for all 22 Issue #6 changes audited, including all 11 created or revised changes. The closure and C8 changes use the supported `skip_specs` declaration for qualification-only scope. Whole-tree strict comparison against a clean exported baseline passed 676 items and reported the same 54 failing item IDs as the starting baseline (675 passed). The older `fix-section-mention-content` change validates with an informational archive issue. Its `MODIFIED Generated flashcard artifact actions` heading is absent from the target `flashcard-studio-section-mentions` main spec. Resolve that historical delta against the active `chat-flashcard-artifacts` contract if archiving it. The AI reliability change owns residual work and does not depend on that archive.

Checked 46 unique inventory rows, all 29 screenshot links, every issue-to-task target, relative links in the program documents, scoped task source references, and acyclic dependency order. The current changes do not introduce an archive diagnostic.
