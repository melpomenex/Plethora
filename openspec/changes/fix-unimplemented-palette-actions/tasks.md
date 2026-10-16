## 1. Audit and reproduce advertised action gaps

- [x] 1.1 Inventory global, contextual, and help actions reachable through Actions, View All, and search in `action-audit.md`; verify each row names its effective command ID, handler, prerequisites, platform support, promised outcome, and existing or required validation.
- [x] 1.2 Add failing integration coverage for Translate Selection, Manage Queues, New Queue, and Saved Queues: Quick Review from a document; verify the failures assert absent result/dialog or incorrect effective queue contents rather than only missing events.
- [x] 1.3 Audit the remaining import, scan, Ask Library, flashcard, recording, theme, shortcuts, and optimal-session commands and record concrete reproductions for any broken outcome; verify each advertised path has a handler and applicable platform fixture in the inventory.

## 2. Make command execution and destination delivery reliable

- [x] 2.1 Reuse or add a typed transient destination request with invocation and pane/tab identity, readiness consumption, acknowledgment, cancellation, and failure reporting; verify tests cover delayed mount beyond 150 ms, an already active destination, supersession, abandonment, and single consumption with two mounted panes.
- [x] 2.2 Route keyboard and pointer activation across browse/search and any remaining legacy palette entry points through shared execution handling; verify synchronous throws, async rejection, repeated pending activation, and dialog focus transfer behave consistently.
- [x] 2.3 Migrate Manage Queues, New Queue, and toolbar entry points from timed events to destination requests; host or share the existing queue modal flows across desktop and mobile and verify each opens once and can complete its intended operation after slow navigation.
- [x] 2.4 Repair other dead or incomplete advertised command paths found in task 1.3, migrate timer handoffs where needed, and consolidate Record Lecture through supported backend selection; verify observable outcome tests for each repaired path and exactly one recording command per supported platform.

## 3. Apply saved queues completely and keep commands current

- [x] 3.1 Subscribe palette catalogue construction to current collection saved queues and loading/error state; verify late loads, create, rename, delete, and collection changes update an already open palette, with recoverable errors distinguished from empty data.
- [x] 3.2 Make activation resolve the current profile by ID and surface persistence failure with prior-state restoration; verify stale/deleted IDs, persistence rejection, retry, and successful persisted activation.
- [x] 3.3 Share the full profile application path between dropdown and palette, including filters, item types, duration, maximum items, goal, and ranking preset; verify late data, already active profile reselection, changed temporary filters, and zero eligible items on desktop and mobile.
- [x] 3.4 Verify Quick Review selects the actual named preset without automatically starting review, and that subsequent Scroll Mode uses the effective profile; use mixed eligible/ineligible fixture items to assert displayed and session membership plus configured limits.

## 4. Complete selection translation

- [x] 4.1 Capture and retain the active reader selection before palette focus using existing selection infrastructure, and expose translation through the typed contextual registry; verify PDF, EPUB/iframe, HTML, and text snapshots survive focus while inactive or stale document selections are rejected.
- [x] 4.2 Connect the owning reader's passage translation UI to the shared translation service, preserving whole-selection text and anchors separately from sentence mode; verify a multi-sentence selection is translated completely and existing sentence-mode tests still pass.
- [x] 4.3 Resolve translation direction from the profile/settings or a target-language prompt without silently enabling Language Mode; verify local offline success, permitted remote fallback, truthful provenance, and recoverable missing-model/provider/setup states using provider mocks.
- [x] 4.4 Add progress/result/error/retry and owner-lifetime cancellation handling, update the unconditional on-device description, and localize new copy; verify original text remains intact, dialog/result focus is correct, and late results never appear in another reader.

## 5. Validate the integrated outcomes

- [x] 5.1 Run focused new integration tests and existing command hub, saved queue, queue filtering/Scroll Mode, translation, and selection suites with `npx vitest run` and the relevant paths; record passing commands and any pre-existing failures separately.
- [x] 5.2 Exercise keyboard and pointer invocation through Actions, View All, and search in desktop and mobile browser layouts; verify real dialogs, filtered queue contents, translation results, empty/error states, and focus, and record screenshots or browser-test evidence in `action-audit.md`.
- [x] 5.3 Validate native-only capture/scan behavior on suitable runtimes where available and capability gating with platform fixtures; record actual runtime coverage and any unavailable native verification explicitly in the audit.
- [x] 5.4 Run the repository's applicable type/lint checks and local `npm run bench:check`; verify no new failures or performance/bundle regressions, and update performance baselines only for an intentional measured change with a documented reason.
- [x] 5.5 Reconcile every advertised command in `action-audit.md` with an implemented outcome or legitimate platform exclusion and verification evidence, then run `openspec validate fix-unimplemented-palette-actions --strict`; verify the named actions are completed and no known supported advertised no-op remains.
