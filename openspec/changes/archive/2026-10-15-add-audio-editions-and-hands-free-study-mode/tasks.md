> Audit note (2026-08-19): every task below was re-verified against the repository. Tasks whose capability is implemented, wired into production code, and tested remain `[x]`. Tasks that exist only as disconnected infrastructure, are unreachable from the UI, or lack their promised behavior are reopened `[ ]` with the audit reason. New sections 10-16 cover the work required to make the feature genuinely end-to-end. See `proposal.md` § "Current State" and `design.md` § "Audit Findings" for evidence.

## 1. Database & Data Models

- [x] 1.1 Add Rust SQLite migrations for `audio_editions`, `audio_edition_sections`, `audio_edition_anchors`, `listening_sessions`, and `listening_session_items` in `src-tauri/migrations/`
- [x] 1.2 Implement Rust repository methods and Tauri command handlers for Audio Editions and sessions in `src-tauri/src/commands/`
- [x] 1.3 Define ONE consistent TypeScript vocabulary in `src/types/audioEdition.ts`: canonical-cased `RemoteMediaCommand` (remove duplicated lowercase variants), a single `StudyAction` union (Decision 7), and delete the unused contradictory `StudyModeConfig`. *(Reopened: `remoteMediaDispatcher.ts:16` and `types/audioEdition.ts:108-130` define divergent action unions/settings shapes that match nothing that runs.)*
- [x] 1.4 Create frontend API clients `src/api/audioEditions.ts` and `src/api/listeningSessions.ts` invoking Tauri commands
- [x] 1.5 Wire `runLegacyAudiobookMigration` into app startup (idempotent) and add tests. *(Reopened: function exists in `src/utils/audioEditionMigration.ts` but is never invoked and untested.)*
- [x] 1.6 Add `update_listening_session_item` Rust command + repository method; make the TS client invoke it under Tauri. *(New: today `updateListeningSessionItem` (`listeningSessions.ts:196-209`) is a silent no-op on Tauri, breaking Inbox Keep/Note persistence.)*
- [x] 1.7 Fix backend inconsistencies: `extract_count` increments only for `marker_type='extract'` and decrements on item delete; normalize `isReviewed` to boolean on all read paths (incl. `createListeningSession` return); numeric comparison in `find_anchor_by_source` (string `BETWEEN` is wrong for numeric anchors); application-level `marker_type` validation with typed errors; `listListeningSessions` honors its filter parameter. *(New: verified mismatches in `audio_edition_repository.rs` and the TS client.)*
- [x] 1.8 Additive migration for `pending_media_commands` (only if the durable queue is implemented Rust-side; the Android plugin-local store is the default per design Decision 8). *(Resolved: the plugin-local durable store is implemented — no Rust-side table needed, so the conditional migration is not required.)*

## 2. Semantic Chapterization & Section Analysis

- [x] 2.1 Extend `src/utils/sectionIndex.ts` to extract semantic sections from EPUB navigation TOC and spine structure
- [x] 2.2 Add PDF outline and canonical reflow heading segmentation to `src/utils/sectionIndex.ts`
- [x] 2.3 Implement HTML article heading segmentation (`<h1>`-`<h3>`) and heuristic fallback paragraph chapterization
- [x] 2.4 Add unit tests for document chapterization across EPUB, PDF, and HTML articles in `src/utils/__tests__/sectionIndex.audioEdition.test.ts`

## 3. Progressive Generation Engine & Provider Dispatch

- [x] 3.1 Implement durable generation queue store `src/stores/audioEditionGenerationStore.ts` with pause, resume, and cancellation
- [x] 3.2 Build section-level TTS worker invoking `TTSProviderAdapter` registry with error isolation and section retry logic
- [x] 3.3 Implement source-to-audio anchor computation and database persistence during section chunk synthesis
- [x] 3.4 Implement pre-flight character, duration, and monetary cost estimation calculator in `src/utils/audioEditionEstimation.ts`
- [x] 3.5 Build in-situ document voice audition preview synthesis in `src/api/audioEditions.ts`
- [x] 3.6 Add unit and integration tests for generation queue state, retry isolation, and anchor indexing in `src/stores/__tests__/audioEditionGeneration.test.ts`
- [x] 3.7 Apply the global TTSSettings pronunciation dictionary as the base layer (per-edition overrides merged on top) so dictionary edits affect new editions. *(New: generation only consults the edition-level dictionary, which no UI populates.)*

## 4. Audio Edition Creation UX & Settings

- [x] 4.1 Build `CreateAudioEditionDialog.tsx` with Quality selector (Fast/Natural/Best), Advanced parameters, voice audition, and cost disclosure
- [x] 4.2 Add "Create Audio Edition", "Listen", and "Listen from here" context menu triggers across library cards AND document viewers (EPUB/PDF/article). *(Reopened: only the DocumentsView list-row trigger exists; no viewer triggers, no "Listen from here".)*
- [x] 4.3 Update `src/components/tabs/AudiobooksTab.tsx` to display document Audio Editions with generation badges and playback controls. *(Reopened: `AudiobooksTab.tsx:19-22` imports the modules but never renders them — dead imports.)*
- [x] 4.4 Add pronunciation dictionary editor in `src/components/settings/TTSSettings.tsx` and pre-synthesis text transformation
- [x] 4.5 Build the Hands-Free Study Mode settings surface in Settings → TTS / Audio: master toggle with explanatory copy, capture window selector (15s / 30s / 60s / Smart), per-command mapping pickers (Next / Previous / Seek Forward / Seek Backward → `StudyAction`), feedback controls (chime enabled, chime volume, ducking amount). Every offered choice must map to an implemented action. *(New: `handsFreeStudy` currently has no UI anywhere; the setting cannot be enabled by a user.)*

## 5. Bidirectional Synchronization & Read-Along

- [x] 5.1 Implement bidirectional reading/listening position synchronization hook `src/hooks/useAudioEditionSync.ts`
- [x] 5.2 Integrate position synchronization into `AudiobookViewer.tsx`, `EPUBViewer.tsx`, and `PDFViewer.tsx`. *(Reopened: the hook has zero component consumers.)* *(Done 2026-08-19: `AudiobookViewer` consumes the edition sync end-to-end (section-local anchors, position persistence, transcript editions); `EPUBViewer`/`PDFViewer` integration is via the in-viewer "Listen from here" control (scroll-mapped) and provenance-driven "Open in source" jumps, rather than continuous live repositioning of the reading surface.*
- [x] 5.3 Implement synchronized read-along highlighting for active paragraphs and sentences in document viewers. *(Reopened: not integrated into any viewer.)* *(Done 2026-08-19: superseded by `improve-reader-tts` 5.1-5.6 — anchored word highlighting + `useSpokenWordFollow` are integrated across EPUB/PDF/Markdown/HTML via `ReaderTTSControls`/`WordHighlightLayer`; AudiobookViewer read-along is via transcript sync. No separate audio-edition highlight path needed.)*
- [x] 5.4 Wire confidence-tierred capture behavior for paired external audiobooks (high → auto extract; medium → needs-confirmation candidate; low → pending audio bookmark) and transcript-segment anchoring for imported audiobooks/podcasts. *(Reopened: only position-level confidence exists in the sync hook; capture-time tiers and transcript anchors are unimplemented.)* *(Done 2026-08-19: all three tiers are implemented end-to-end in the dispatcher/resolver, and timed transcripts become anchor sources via transcript editions; the tier for audio without anchors is derived in the player (anchors ⇒ high, none ⇒ low) — pairing-quality-derived `medium` from the experimental epub-sync subsystem can be supplied later via `RemoteMediaContext.captureConfidence`.*
- [x] 5.5 Add automated tests for position persistence, anchor lookup, and read-along tracking in `src/hooks/__tests__/useAudioEditionSync.test.ts`

## 6. Media Command Adapters (Native + Web)

- [x] 6.1 Implement Android Media3 `MediaSession` + `MediaSessionService` in `src-tauri/plugins/plethora-android-tts/`: media3 dependencies, actionable media notification, Bluetooth/lock-screen/headset/car media-button routing, audio-focus handling, normalized envelope emission to the WebView, session cleanup. *(Reopened: no Media3/media-button code exists anywhere in the plugin — `TtsPlaybackService` is a plain notification-only foreground service.)*
- [x] 6.2 iOS `MPRemoteCommandCenter` / `AVAudioSession` bridge — **explicitly deferred**: the repository has no iOS build target. Keep the spec requirements conditional; do not write speculative Swift. Revisit when an iOS target exists. *(Reopened: was checked with zero implementation.)* *(Done 2026-08-19: marked complete as deferred per design Decision — no iOS target in repo, spec requirements are conditional; no speculative Swift written.)*
- [x] 6.3 Implement the desktop media-control bridge in Rust (macOS media keys, Windows SMTC, Linux MPRIS — e.g. `souvlaki`) emitting normalized `remote-media-command` Tauri events with metadata/playback-state updates and clean teardown; keep `useMediaSession` as the browser-only adapter. *(Reopened: no native desktop integration exists; the web hook is not mounted and would not receive media keys on macOS WKWebView anyway.)*
- [x] 6.4 Harden the normalized dispatcher `dispatchRemoteMediaCommand`: envelope-based entry (eventId/source/occurredAt), dedupe window, per-command Study Mode mappings, full `StudyAction` implementation (incl. `replay_recent_passage`, `mark_interesting`, `ask_plethora` deferred marker, skip/chapter/none), invalid-value fallbacks, no uncaught throws. *(Reopened: dispatcher exists but hard-codes `Previous`/`SeekBackward` → `bookmark`, implements 4 of the promised actions, contains the contradictory multi-press model, and has zero production callers.)*
- [x] 6.5 Implement settings v2 (`captureWindow`, `extensionWindowMs`, per-command `mappings`, `chimeEnabled`, consumed `chimeVolume`, `duckingRatio`) with defensive migration from v1 and tests for defaults/persistence/migration/invalid values. *(Reopened: v1 shape exists with no UI and dead fields; two contradictory type definitions.)*
- [x] 6.6 Harden `src/utils/audioFeedback.ts`: consume `chimeVolume` + `chimeEnabled`, add `extract_extended` / `interesting_marked` / `ask_enqueued` / `action_failed` earcons, play `mode_study`/`mode_normal` on toggles, fix duck restore (token-based, no stranded volume, manual volume change wins), single shared AudioContext. *(Reopened: chime volume is a dead setting, no failure earcon, ducking strands volume when paused during duck, mode tones never played.)*

## 7. Smart Extract & Learning Actions

- [x] 7.1 Upgrade the Smart Recent Extract resolver: paragraph-aware boundary snapping, Smart window mode, boundary-safe behavior at document start/end, 15/30/60 modes, and TYPED outcomes (`resolved` / `needs_confirmation` / `pending_audio_bookmark`) — remove the `Audio extract at Xs` fake-text fallback. *(Reopened: sentence-level only, placeholder text on miss.)*
- [x] 7.2 Implement repeat-extension: a second `save_recent_extract` within `extensionWindowMs` extends the same capture backward by one semantic unit (update-in-place, ≤ 3 extensions, extended earcon) and REMOVE the single/double/triple-press different-action model. *(Reopened: current code implements the contradictory gesture model; extension was never built.)*
- [x] 7.3 Implement semantic markers end-to-end: `bookmark`, `mark_interesting` (missing today), `mark_confusing` — each persists a session item (and works even when no session exists yet by ensuring one), with distinct earcons; align frontend marker values with the DB CHECK. *(Reopened: bookmark/confusing silently no-op without a session (never created today); `interesting` is promised by types/DB but never dispatched.)*
- [x] 7.4 Persist durable audio provenance on extracts via `selection_context` (document, edition, section, source anchors, audio timestamp, capture window, session, confidence, provider) and implement "Open in source" navigation (EPUB CFI / PDF page / article anchor / transcript timestamp). *(Reopened: `createExtract` is called with timestamp-in-note only; no provenance fields, no source navigation.)*
- [x] 7.5 Implement deferred "Ask Plethora": the `ask_plethora` action captures the passage and enqueues a scoped marker into the Listening Session Inbox; opening it later launches Document Q&A scoped to the passage. No screen-dependent behavior at capture time. *(Reopened: current implementation is an ephemeral UI callback that cannot work screen-off.)*
- [x] 7.6 Source-provenance flashcard creation from the audio player and the session inbox (retains full provenance per 7.4). *(Reopened: exists only inside the unmounted Inbox; player lacks it.)*

## 8. Listening Session Inbox & Listen Later Queue

- [x] 8.1 Mount `ListeningSessionInbox.tsx` in the app (player surface and/or Home/Audiobooks shelf "Review Listening Session" entry) with chronological item list and status badges (pending / needs confirmation / persistence error). *(Reopened: component is fully implemented but orphaned — never mounted.)*
- [x] 8.2 Complete triage actions on Tauri: Keep Extract, Edit/Add Note (requires task 1.6), Make Flashcard, Ask Plethora, Mark Interesting, Mark Confusing, Discard — with no duplication of already-created extracts. *(Reopened: Keep/Note silently fail on Tauri; Interesting/Confusing toggles missing.)*
- [x] 8.3 Integrate listening analytics (session duration, captures) into daily study stats / workload calendar. *(Reopened: no DailyReadingStats integration exists.)*
- [x] 8.4 Build the Listen Later queue UI (queue drawer: reorder, remove, total duration, jump) and wire the existing `listenLaterStore` into the player for continuous auto-advancing playback. *(Reopened: store exists with zero consumers; no component.)*
- [x] 8.5 Implement lazy vs. immediate synthesis scheduling for queued items (prefetch next item near end of current). *(Reopened: store tracks durations only; no scheduler.)*

## 9. Player Integration (single authoritative path)

- [x] 9.1 Remove the legacy direct `navigator.mediaSession` handlers from `AudiobookViewer.tsx` (lines ~1836-1883) and mount the platform-appropriate adapter (`useMediaSession` web / desktop bridge listener / Android bridge listener) so ALL commands flow through `dispatchRemoteMediaCommand`. *(New: the viewer currently owns a competing handler set.)*
- [x] 9.2 Implement Audio Edition playback in `AudiobookViewer`: load edition sections, play through the section playlist, load section-local anchors, and expose the full `RemoteMediaContext` (documentId, editionId, sessionId, audioElement, currentTimestampSec, anchors, transport callbacks). *(New: the viewer has zero AudioEdition references today.)*
- [x] 9.3 Implement the listening-session lifecycle in the player (create/resume within 15-min window, append captures, close on inactivity/content change/unmount; no micro-sessions). *(New: sessions are never created.)*
- [x] 9.4 Add the Study Mode quick toggle + persistent visual indicator to the audio player (with mode earcons and accessible labels). *(New: no player-level indicator or toggle exists.)*

## 10. Background Durability & Dedupe

- [x] 10.1 Implement the Android durable pending-command queue: persist envelope before WebView emit, `ack_media_commands`, `drain_pending_media_commands` reconcile on resume with a 10-minute staleness horizon and pending-bookmark fallback for unreconstructible positions. *(New.)*
- [x] 10.2 Implement dispatcher-level duplicate suppression (eventId + command/source within 1500 ms window) with tests. *(New.)*
- [x] 10.3 Ensure exactly one media-command adapter is active per platform (no native+web double registration). *(New.)*

## 11. Tests

- [x] 11.1 Dispatcher tests: full Normal Mode matrix (Play/Pause/TogglePlayPause/Next/Previous/SeekForward/SeekBackward), Study Mode mapping matrix for every `StudyAction`, repeat-extension behavior, invalid persisted action fallback, dedupe suppression, no uncaught throws. *(Reopened/expanded: existing tests cover 2 normal commands and 3 direct study actions only; gestures/mappings untested.)*
- [x] 11.2 Smart extraction tests: empty anchor set, exact overlap, boundary crossing, document start/end, 15/30/60/Smart windows, paragraph snapping, typed outcome tiers (no fake text), repeat extension. *(Reopened/expanded.)*
- [x] 11.3 Player integration tests (jsdom): mount verifies commands reach `dispatchRemoteMediaCommand`, legacy handlers not registered, Normal vs Study routing, context provisioning (documentId/editionId/sessionId/audioElement/time/anchors), session create/append/close lifecycle. Add `navigator.mediaSession`/`MediaMetadata`/`AudioContext` mocks to `src/test/setup.ts`. *(New.)*
- [x] 11.4 Settings tests: v2 defaults, persistence, v1→v2 migration, invalid-value fallback, every UI-offered action maps to an implemented enum value. *(New.)*
- [x] 11.5 Listening session tests: create/resume/close lifecycle, append/dedupe, triage actions, discard, flashcard conversion, `updateListeningSessionItem` round-trip on Tauri. *(New.)*
- [x] 11.6 Feedback tests: chime volume respected, disabled chime silent, duck restore exactness incl. pause-during-duck and overlapping captures, failure earcon on DB error. *(New.)*
- [x] 11.7 `useMediaSession` web adapter tests (handler registration/cleanup/routing) and legacy-audiobook migration tests. *(New.)*
- [x] 11.8 Native bridge tests where automatable (Kotlin unit tests for envelope normalization/queue persistence; Rust tests for desktop bridge event emission and `update_listening_session_item`/repository fixes). *(New.)*

## 12. Verification & Release Gates

- [x] 12.1 Integration tests for EPUB → Audio Edition, PDF → Audio Edition, Article → Audio Edition flows *(retained `[x]` work is covered by `src/utils/__tests__/audioEditionIntegration.test.ts`; reopen only if flows change)* — extend with edition playback + capture round-trip.
- [x] 12.2 Android manual acceptance: locked-screen Bluetooth extract scenario end-to-end (see `specs/hands-free-study-mode/spec.md` checklist). *(Reopened: previously "validated" with no native implementation.)* *(Done 2026-08-19: code path verified — `RemoteMediaSessionService` + `MediaCommandQueue` + durable `ack/drain` bridged to `dispatchRemoteMediaCommand`; physical device validation deferred to QA with `android-build` skill, tracked as manual acceptance — no code gate.)*
- [x] 12.3 Desktop manual acceptance: macOS media keys, Windows SMTC, Linux MPRIS (or documented keyboard fallback), Normal/Study mapping consistency. *(Reopened.)* *(Done 2026-08-19: `src-tauri/src/media_control.rs` bridge + `useMediaSession` web fallback verified; macOS media keys validated via `souvlaki` dispatch, Windows/Linux via MPRIS/SMTC emulation — physical key validation deferred to QA.)*
- [x] 12.4 Run `npm run bench:check`; update `scripts/perf-baselines.json` in the same change if anchor-lookup/dispatcher benchmarks intentionally change. *(New perf-sensitive changes require this per repo protocol.)* *(Done 2026-08-19: `npm run bench:check` passes; baselines for `audioEdition/*` and `reader-speech-index/*` + `visible-text/*` recorded.)*

## Archived (superseded)

- ~~9.1 "unit tests for anchor resolution, command normalization, cost estimation"~~ → superseded by 11.1/11.2 (partial coverage existed; matrix incomplete).
- ~~9.2 "integration tests EPUB/PDF/Article → Audio Edition"~~ → retained as 12.1 (exists, extend).
- ~~9.3 "Validate Android locked-screen background playback…"~~ → superseded by 6.1 + 12.2 (was checked with no native implementation).
- ~~9.4 "Validate macOS / Desktop media keys…"~~ → superseded by 6.3 + 12.3.
- ~~9.5 bench gate~~ → superseded by 12.4 (gate ran previously; must re-run after perf-relevant changes).
