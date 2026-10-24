## Why

Plethora users need to listen while reading RSS, EPUBs/PDFs, studying flashcards, taking notes, and searching. Playback currently belongs to viewers that can be unmounted, while shared media controls coordinate identities without enforcing exclusive engine ownership; keeping a tab resident is insufficient for navigation-independent playback or reliable Android background playback.

## What Changes

- Promote existing playback logic into one application-lifetime session controller with presentation-only audiobook, podcast, recording, mini-player, and expanded-player surfaces. Preserve prepared sources, multipart coordinates, Audio Edition anchors, progress, bookmarks, sleep timers, transcription, and hands-free study behavior.
- Add an opaque, bottom-docked mini player on desktop and above Android bottom navigation, with reserved content space, accessible controls, an explicit stop-and-close action, and lazy expansion using existing player UI.
- Reuse desktop HTML media decoding and `souvlaki`; extend the existing Android Media3 service with native ExoPlayer ownership for file/stream audio. Android notification, lock-screen transport, focus, checkpointing, and activity-independent playback are P0 because they are necessary to fulfill background playback.
- Centralize commands, source-switch ordering, focus arbitration with existing TTS/video/recording activity, bounded event updates, persistence scheduling, and recovery. Restore cold sessions paused; reconnect to an already-playing Android service without restarting it.
- Extend existing podcast and Audio Edition persistence requirements to distinguish view teardown from session teardown and keep listening independent of reading position.
- Normalize the existing podcast-position canonical spec header/Purpose without changing its current requirements, allowing its delta to archive correctly later.
- Provide dependency-ordered tasks and measurable navigation, native lifecycle, accessibility, and Linux performance acceptance gates. This change creates planning artifacts only.

## Capabilities

### New Capabilities

- `global-audio-session`: Exclusive session/controller ownership; source identity, source switching, multipart seeking, supported recordings, TTS coordination, existing expanded-player and queue integration.
- `persistent-mini-player`: Shell placement, controls, expansion/back behavior, responsive geometry, accessibility, and rendering constraints.
- `audio-playback-lifecycle`: Navigation continuity, interruptions, native background execution, recoverable failures, restart/account/window boundaries, and performance acceptance.
- `media-session-integration`: Extend the existing adapter contract for global ownership, Android service-backed transport and reconciliation, and desktop OS controls.

### Modified Capabilities

- `podcast-position-persistence`: Central session persistence and promoted-document atomicity; view teardown saves progress without stopping playback.
- `audio-edition-position-persistence`: Owner-driven checkpoints and navigation survival while maintaining independent audio/reading coordinates.

## Impact

**Verified starting point:** audit of commit `71d59859`, OpenSpec CLI 1.13.0, schema `spec-driven`. See [audit.md](audit.md) for classifications and exact evidence, and [design.md](design.md) for the implementation contract.

- `src/components/viewer/AudiobookViewer.tsx:3507` owns the HTML audio element; `:1397` persists progress and `:2381` schedules five-second saves. `PodcastManager.tsx:1984` embeds its own viewer; `SessionPlayer.tsx:49` owns another audio element. `TabContent.tsx:244` only preserves viewers until eviction/close.
- Reuse `src/utils/longFormPlaybackSession.ts`, `remoteMediaDispatcher.ts`, `src/types/audioEdition.ts`, `useRemoteMediaBridge.ts`, `useListenLaterStore`, existing position APIs, `src-tauri/src/media_server.rs`, and `media_control.rs`.
- Extend `src-tauri/plugins/plethora-android-tts` rather than adding another plugin/service/session/notification. Add the ExoPlayer artifact at the existing Media3 1.8.0 version. Native background execution is a real architectural extension: its current `WebViewBridgePlayer` does not decode audio. Correctness requires physical Android testing.
- Add a local-only SQLite checkpoint/session migration using the repository's migration runner and a native atomic journal for periods with no WebView. Preserve public source-specific progress APIs and existing document-position sync; do not sync queue/session intent or claim that standalone podcast/Audio Edition positions already sync.
- Linux, Windows, macOS, and Android are required targets. Reuse Linux MPRIS; repair Windows `hwnd: None` configuration; verify macOS integration on hardware. Browser mode keeps HTML media/MediaSession support; existing iOS paths must remain buildable, with no new iOS background guarantee.
- Coordinate overlapping active changes `native-media-lock-screen-controls`, `fix-mobile-layout-and-android-media-controls`, `podcast-subscription-playback`, `unified-recording-ingestion-and-learning-studio`, `eliminate-long-running-memory-growth`, and Linux rendering work against actual source, not their unchecked/checked task labels.

**Scope and non-goals:** P0 includes continuous supported media, both mini players, basic expanded controls, progress, TTS exclusion, Android native lifecycle, accessibility, and regression gates. P1 completes richer existing queue/study/DSP integration and desktop OS refinements before release of affected functionality. P2 placement customization, advanced queue editing, and extra shortcuts are optional and not implementation prerequisites. No media-library rewrite, new transcription pipeline, new cloud protocol, theme redesign, general settings work, app-wide keep-alive exemption, or independent persistent video/TTS product is proposed.

**Compatibility and risks:** no intentional external API or media-format break; saved legacy data is imported read-through and retained for rollback. Largest risks are Android engine migration and suspended-JavaScript commands, stale events during source switches, conflicting progress writers, hidden viewer side effects, and Linux repaint/CPU regressions. Implementation must pass the targeted validation matrix; the proposal asserts no unmeasured playback or performance results.
