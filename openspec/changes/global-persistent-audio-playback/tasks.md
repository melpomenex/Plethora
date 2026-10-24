Implementation dependency amendment (user authorized 2026-10-23): baseline/device acceptance may remain pending while implementation proceeds behind a disabled internal rollout gate. Capture available baseline evidence before refactoring. Do not mark unexecuted runtime checks complete or enable rollout until the original acceptance matrix passes.

## 1. P0 — Freeze behavior and capture baseline

- [x] 1.1 Read proposal.md, audit.md, design.md, all six delta specs and validation.md; compare audited source anchors to current HEAD and record drift/overlapping active changes in implementation evidence. Verify no implementation/apply occurred during proposal creation and preserve unrelated worktree edits.
- [ ] 1.2 Capture baseline behavior for audiobook/podcast/Audio Edition/recording/TTS, queue, bookmarks, sleep, rate, sponsor skip, optional DSP and learning actions using validation.md fixtures; verify the evidence identifies build/device/runtime and distinguishes existing failures from new regressions.
- [ ] 1.3 Capture the matched performance/paint/CPU/memory baseline and primary navigation journey before refactoring; verify raw traces/counters exist and no threshold is represented as a measured result.

## 2. P0 — Shared contract and desktop runtime authority (depends on 1.1; 1.2–1.3 gate rollout)

- [x] 2.1 Extend `src/types/audioEdition.ts` with recording/error, source identity, unique session incarnation, generation/revision, nullable durations, typed commands/results and pause reasons; verify TS contract tests reject stale sessions and preserve truthful speech capabilities.
- [x] 2.2 Create the singleton controller and injectable HTML engine under `src/services/audio/`; implement idempotent initialization/disposal, serialized play/pause/toggle and transition state; verify one engine after StrictMode/double initialize and Play/Pause idempotence.
- [x] 2.3 Extract existing media preparation, podcast local/remote fallback, recording `get_recording_media_path`, edition section updates and multipart manifest resolution into the source resolver; verify authorized local Range paths, m4b desktop/mobile differences, missing/partial/unsupported files and no whole-file Blob ingestion.
- [x] 2.4 Implement takeover generation, pause acknowledgment, captured-old-identity checkpoint, cancellation and late-event rejection; verify deferred A/B/C resolution, late ended/play callbacks, timeout and pause-failure tests never overlap audio.
- [x] 2.5 Implement global/part coordinate conversions, known/unknown seekability, part/section transitions, rate/volume and owner sleep deadlines; verify cross-boundary seeks, >24h values, paused seeks and sleep-before-next behavior.
- [x] 2.6 Add selector-based `audioPlaybackStore` projection and main-window-only GlobalAudioHost above routing/layout branches in `src/main.tsx`; verify tab close/eviction, split panes, responsive wrapper swap and utility/auth window do not dispose or duplicate engine/listeners.

## 3. P0 — Durable persistence and compatibility (depends on 2.1–2.5)

- [x] 3.1 Add the next available additive SQLite migration for design section 6 checkpoint/session tables and typed Rust checkpoint repository/commands; verify migration from legacy schema, duplicate/stale epoch commits and malformed payloads using temporary SQLite tests.
- [x] 3.2 Implement single controller persistence scheduler (five-second changed-position cadence, transition flush, one in-flight plus latest, bounded retry); verify fake-clock write counts, pause/no-change silence, seek-drag coalescing and failure recovery tests.
- [x] 3.3 Consolidate promoted-podcast checkpoint updates to episode + verified mapped document + existing document-sync journal in one Rust transaction; verify injected failure rolls all back and standalone episode IDs never address a document.
- [x] 3.4 Preserve ordinary audiobook position APIs and edition browser-store compatibility; prevent Audio Edition time saves from modifying text-document position/reading percentage; verify simultaneous EPUB/PDF reading and audio checkpoint integration tests.
- [x] 3.5 Implement versioned current identity/queue/rate restoration paused, profile namespaces and legacy read-through with live-service-first reconciliation; verify invalid/deleted source, media revision mismatch, cold recovery, remote progress merge and logout/stop failure behavior.
- [x] 3.6 Add browser-backend handlers/local checkpoint storage for the shared facade while keeping existing `browserInvoke` position/episode behavior; verify browser-mode restart/unsupported native invocation tests pass and existing keys/bookmarks remain readable.

## 4. P0 — Android service owns ordinary media (depends on 2 contract and 3 checkpoint contract)

- [x] 4.1 Extend existing android-tts plugin dependencies with ExoPlayer 1.8.0; implement application/service-owned PlaybackCoordinator, real player and authorized file/content/remote manifest loading; verify plugin Gradle tests/build, main-looper command serialization and no Activity/WebView-held decoder.
- [x] 4.2 Add versioned plugin load/command/snapshot/reconcile commands, Rust registration and generated ACL entries; subscribe-before-snapshot frontend adapter with native OS detection; verify Android never instantiates an HTML decoder for native sources and iOS/browser are not misrouted.
- [x] 4.3 Implement bounded AtomicFile checkpoint/session journal, native five-second cadence and critical-transition flush; verify interruption/crash atomicity, dirty-source capacity rejection, per-profile epochs, import/ack-after-DB-commit and no dependence on JS/database availability.
- [x] 4.4 Execute native system transport in the service and publish applied observation receipts rather than replayable transport; verify locked/suspended-JS play/pause/seek and reconnect apply every physical event exactly once while preserving distinct rapid seeks.
- [x] 4.5 Implement native part/ready-queue progression, rate, sleep deadlines and safe stop at unprepared synthesis boundary; verify these continue without WebView and sleep prevents auto-advance.
- [x] 4.6 Reuse one MediaSession/notification lifecycle, enforce foreground eligibility and bounded playback wake ownership, verify merged manifest/permissions against target 36 and POST_NOTIFICATIONS deny/allow behavior; verify tests distinguish exempt media notifications from actual service-start failure and no force-stop/reboot autoplay.
- [ ] 4.7 Implement activity recreation/reconnect, ongoing-playing task dismissal, pause/stop teardown and native dirty-journal reconciliation; verify device/emulator tests reconnect without load/seek and cold process recovery is paused within five seconds of last progress.

## 5. P0 — Unified focus and source entry-point migration (depends on 2–4)

- [x] 5.1 Add exclusive focus leases for reader TTS, useTTS, native TTS, video starts, hands-free feedback and recording capture; verify late speech generation/chunk callbacks cannot play after revocation and prior media never auto-resumes on completion/unmount.
- [x] 5.2 Reuse native focus state machine with the service as sole AudioManager owner, disable competing ExoPlayer/TTS focus requests, and wire real decoder pause/volume/noisy handling; verify transient/permanent/duck/gain and user-pause/source-switch-before-gain tests.
- [x] 5.3 Convert AudiobookViewer to controller-backed presentation, move restore/timers/source/ended/sleep and listening-session policy to owner, preserve its public callbacks via subscriptions; verify existing viewer/multipart/edition tests plus tab-close/eviction integration tests.
- [x] 5.4 Migrate PodcastManager/DocumentViewer/queue-scroll listening entry points and podcast continuation to explicit source/queue contexts; verify episode identity, explicit autoplay, distinct promoted document ID and reattachment without re-seek.
- [x] 5.5 Migrate LearningStudio SessionPlayer to the same session with transcript/marker seek subscriptions and consolidated recording source resolution; verify ready/missing/partial/transcript-only tests and recording-to-notes continuity.
- [x] 5.6 Move existing desktop/browser remote bridge registration to the owner, replace registry mutation with compatibility reads and remove migrated per-view registrations; verify source unmount cannot stop another session's OS controls and grep confirms no production duplicate owner path.

- [x] 5.7 Add cfg-gated desktop lifecycle observers for pre-suspend/wake and available output interruptions, routing one normalized lifecycle event to the owner; verify minimizing does not pause, suspend flushes/pauses, wake remains paused and observers unregister at app shutdown on Linux/Windows/macOS.

## 6. P0 — Dock, essential expansion and accessibility (depends on 5)

- [x] 6.1 Add opaque themed desktop MiniAudioPlayer with artwork/title, appropriate -30/+30 or -10/+30, play/pause, progress, queue/expand/stop access and measured reserved shell height; verify geometry at laptop sizes and 100/125/150% zoom and no initial expanded-player bundle import.
- [x] 6.2 Add compact mobile dock above MobileNavigation, one safe-area contribution and unified BottomControlsGeometry/assistant/reader clearance; verify 320–412px phones, tablets, rotation, keyboard, modal/fullscreen, selection/bulk/review/capture controls and compensated reading anchor.
- [x] 6.3 Add lazy ExpandedAudioPlayer reusing AudiobookViewer presentation and MD3/Back primitives; preserve essential transport/seek/rate/chapters/bookmark/sleep/source return; verify expansion creates no decoder/restore/timer, Back/Escape collapses first and source reading/review focus state is preserved.
- [x] 6.4 Add localized labels, semantic region, current-state messaging, slider value text, 40/48px targets and theme/reduced-motion treatment; verify keyboard/assistive checks, no global shortcut theft, contrast and no per-second screen-reader announcement.
- [x] 6.5 Add recoverable inline source/storage/focus errors, meaningful fallback artwork and Stop-versus-collapse semantics; verify deletion, URL expiry, missing/corrupt/offline sources, retry cancellation, queue pruning and stop/reload progress preservation.

## 7. P0 — Prove the core promise (depends on 1–6; required before enabling rollout)

- [ ] 7.1 Add full-shell browser integration/visual harness for journeys A–E and the exact primary regression chain in validation.md, using real local media fixtures plus engine diagnostics; verify close/eviction/split-pane and reading/review isolation, not merely player snapshots.
- [ ] 7.2 Run packaged Linux primary journey with audible marker capture, source event trace, paints and matched performance/heap/CPU checks; verify no reload/duplication, no >=100ms navigation-correlated audio gap, no tick-driven unrelated renders, flicker/bleed or budget regressions.
- [ ] 7.3 Execute physical Android matrix for lock/background/activity recreation/disconnected JS/native buttons, Bluetooth/wired/call/focus/task-removal, service refusal, notification permission and process death; verify build/device evidence and native journal reconciliation before marking P0 complete.
- [ ] 7.4 Run applicable existing/new Vitest, Gradle/Cargo checks, lint, build/docs/bundle, script, bench and memory gates in validation.md; verify failures are resolved or explicitly recorded as pre-existing with evidence and no budget is silently weakened.

## 8. P1 — Complete existing feature parity and desktop integration (implementation may proceed alongside P0; all acceptance required before rollout)

- [x] 8.1 Reuse listeningQueueStore item/order shape as controller-backed queue, migrate existing Listen Later synthesis/current-playing projection and PodcastManager continuation without competing status authority; verify queue restoration, prefetch, end-once, missing-item and stopped auto-advance tests.
- [x] 8.2 Preserve remote dispatcher Study Mode maps and source-provenance actions; native transport executes once and deferred capture journals original press-time source/part/anchor; verify duplicate receipt, stale transport and cross-source deferred capture tests without fabricated text.
- [x] 8.3 Preserve optional silence skip, volume boost, sponsor/precut segment policies and paired reading/listening anchor synchronization under owner lifetime, adding native service processing where supported; verify original-media time/anchor accuracy and no parallel WebAudio decoder. Keep affected rollout disabled until truthful capability/parity acceptance, rather than silently dropping existing controls.
- [x] 8.4 Finish lazy expanded transcript, learning/extract/flashcard and queue editing affordances using existing components with bounded section data; verify all pre-refactor baseline capabilities remain usable without requiring a hidden heavy source view.
- [x] 8.5 Repair desktop souvlaki ownership lifetime, valid Windows HWND/thread configuration and truthful capability/error diagnostics while preserving Linux MPRIS/macOS integration; verify Rust mapping tests and paused session survives bridge inactivity without tick heartbeat dependency.
- [ ] 8.6 Run physical Windows SMTC/macOS Now Playing and Linux Wayland/X11 adapter/focus/suspend matrix; verify hardware evidence and in-app fallback behavior when an adapter is unavailable, without claiming untested platform support.
- [ ] 8.7 Document user-visible behavior, compatibility/restore/stop/error policies and platform evidence in existing help/docs; verify `npm run docs:validate`, full required gates and all P0/P1 acceptance findings before removing legacy playback-owner paths or enabling production rollout.

## 9. P2 — Optional follow-up scope (not required implementation checkboxes)

Configurable placement, advanced queue editing, new global shortcuts and additional playback preferences are explicitly deferred. They require a separate justified change, Settings search coverage where applicable, and must not block P0/P1 completion or be implemented incidentally here. This section contains no tasks for the current apply workflow.
