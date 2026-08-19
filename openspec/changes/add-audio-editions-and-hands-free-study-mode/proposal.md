# Change: Unify Audio Editions and Hands-Free Study Mode

## Why

Plethora already contains substantial TTS and audiobook infrastructure across multiple subsystems (8+ TTS provider adapters including OpenRouter, local Whisper/Groq transcription, an Audiobooks shelf tab, EPUB/audiobook pairing, and basic web media session hooks). However, audio generation and playback remain fragmented: audiobooks are treated as external or monolithic audio files disconnected from the core reading engine, generating long audio blocks the user from listening immediately, reading and listening progress are tracked independently, and mobile listeners cannot capture extracts or annotations hands-free while walking, commuting, or exercising.

This change unifies Plethora's TTS and audiobook capabilities into a single first-class **Audio Edition** system for any readable library item (EPUB, PDF, reflowed PDF, saved/imported web articles, and paired external audiobooks) coupled with a **Hands-Free Study Mode** that captures source-linked textual extracts, bookmarks, and learning moments via standard OS-level headphone/media remote commands without looking at a screen.

## Current State (Code-Grounded Audit, 2026-08-19)

A previous pass marked all tasks complete. A file-by-file audit of the repository shows that the foundation layers are real and tested, but the hands-free feature is **not wired end-to-end and is not reachable by any user**. Key facts:

**Implemented and functioning**
- SQLite migration `089` plus 23 Rust commands and repositories for audio editions and listening sessions (`src-tauri/src/commands/audio_editions.rs`, `src-tauri/src/database/audio_edition_repository.rs`); all TS API clients invoke matching commands.
- Semantic chapterization for EPUB/PDF/HTML with tests (`src/utils/sectionIndex.ts`, `src/utils/__tests__/sectionIndex.audioEdition.test.ts`).
- Progressive per-section generation store with retries, pause/resume, anchor persistence (`src/stores/audioEditionGenerationStore.ts`), driven by `CreateAudioEditionDialog.tsx` (mounted from DocumentsView), including quality presets, voice audition, and cost estimation.
- Read/listen sync hook `src/hooks/useAudioEditionSync.ts` with high/medium/low position confidence and tests — but no viewer consumes it.
- Web `navigator.mediaSession` hook (`src/hooks/useMediaSession.ts`) normalizing commands into `dispatchRemoteMediaCommand` (`src/utils/remoteMediaDispatcher.ts`) — but see below.

**Not wired / broken / missing (why this proposal reopens tasks)**
- `useMediaSession` has **zero production consumers**; `AudiobookViewer.tsx:1836-1883` still registers its own legacy direct handlers (`nexttrack` → +30s skip, `previoustrack` → −15s rewind), bypassing the dispatcher entirely. Two competing media-command paths.
- `handsFreeStudy` settings exist (`settingsStore.ts:637-655`) but there is **no UI anywhere** to view or change them; Study Mode defaults to disabled and cannot be enabled by a user.
- `createListeningSession` is **never called** in production, so `RemoteMediaContext.sessionId` is always absent — bookmark/confusing markers silently no-op. `ListeningSessionInbox.tsx` is fully implemented but **never mounted**.
- Two contradictory `StudyActionType` unions exist (`remoteMediaDispatcher.ts:16` vs `types/audioEdition.ts:108-116`), and `StudyModeConfig` in `types/audioEdition.ts:118-130` matches nothing that runs. The dispatcher implements only 4 of the promised actions; `Previous`/`SeekBackward` are hard-coded to `bookmark` regardless of settings; `mark_interesting` and `replayRecentPassage` do not exist.
- The dispatcher's multi-press gesture model (single/double/triple → different actions) contradicts the design's repeat-extension semantics (repeat extends the same capture backward). Neither is fully implemented or tested.
- Smart extract falls back to fake text (`Audio extract at 123s`) when anchors miss, creating garbage extracts.
- `audioFeedback.ts` ignores the persisted `chimeVolume`, has no failure earcon, never plays the existing `mode_study`/`mode_normal` tones, and its ducking can permanently leave volume ducked if the user pauses during the duck window.
- **No native media sessions exist at all.** The Android plugin's `TtsPlaybackService` is a plain foreground service (no Media3, no media-button handling, no actionable notification); there is no iOS code and no iOS build target in the repository; there is no desktop media-key integration (macOS WKWebView does not deliver system media keys to `navigator.mediaSession`).
- `updateListeningSessionItem` (used by Inbox Keep/Note actions) is a **silent no-op on Tauri** — no Rust command exists.
- `runLegacyAudiobookMigration` exists but is never invoked and untested. `AudiobooksTab.tsx` imports audio-edition modules but never renders them (dead imports). `listenLaterStore` has no UI. `useAudioEditionSync` is imported by no viewer. Audio Edition playback itself (section playlist in the player) is not integrated into `AudiobookViewer`.
- Test coverage: dispatcher gestures, `useMediaSession`, `audioFeedback`, listening-session API, hands-free settings defaults/migration, and player integration are untested; `src/test/setup.ts` has no `navigator.mediaSession`/`AudioContext` mocks.

The purpose of this amended proposal is to finish and harden the feature so it is genuinely usable: a user can pocket their phone, listen to a Plethora Audio Edition or audiobook, enable Hands-Free Study Mode, and create source-linked captures with ordinary headphone controls while the screen is locked.

## What Changes

- **Canonical Audio Edition Model**: A first-class manifest model (`AudioEdition`) associating a source document and revision hash with semantic sections, generation settings, TTS provider/model/voice metadata, independent audio assets, and source-to-audio anchors. *(Implemented; retained.)*
- **Semantic Chapterization**: Structural segmentation leveraging EPUB TOC/spine, PDF outlines/reflow blocks, HTML article headings, and heuristic fallbacks. *(Implemented; retained.)*
- **Progressive Section Generation & Resumability**: Generate audio incrementally per chapter/section with early playback, per-section failure isolation, and durable job state. *(Implemented; retained.)*
- **Generic Multi-Provider Integration with Guardrails**: Reuse the generic TTS abstraction (OpenRouter, Pocket, Fal, Android sherpa-onnx, ElevenLabs, OpenAI, System) with Fast/Natural/Best presets, advanced selector, document-text voice preview, and cost/duration guardrails. *(Implemented; retained.)*
- **Single Authoritative Media-Command Path**: All media commands — Web MediaSession, native Android bridge, desktop media keys — normalize into one `RemoteMediaCommand` stream handled by one dispatcher. `AudiobookViewer`'s legacy direct handlers are removed. Play/Pause are never remapped.
- **Real Native Media Sessions**: Android gains a genuine Media3 `MediaSession`/`MediaSessionService` with media-button routing, an actionable media notification, audio-focus handling, and a durable pending-command queue so no button press is lost when the WebView is backgrounded. Desktop gains a Rust-side media-key/media-control bridge (macOS/Windows SMTC/Linux MPRIS). iOS is explicitly out of scope (no iOS build target exists in this repository) and its requirements are marked conditional.
- **Configurable OS-Command Mappings (Settings v2)**: A dedicated Settings → TTS / Audio → Hands-Free Study Mode surface: master toggle, capture window (15s / 30s / 60s / Smart), per-command mappings for Next / Previous / Seek Forward / Seek Backward across a fully implemented action enum, and feedback controls (chime on/off, chime volume, ducking amount). Persisted settings are migrated defensively from the v1 shape; invalid legacy values fall back to defaults.
- **OS-Command-Authoritative Interaction Model**: Plethora reacts to the normalized OS command (Next, Previous, …), never to vendor gestures. Repeating *Save Recent Extract* within the extension window extends the same capture backward by one semantic unit instead of creating duplicates. The contradictory single/double/triple-press model is removed.
- **Typed Capture Outcomes (No Fake Text)**: Smart Recent Extract resolves real source text via anchors; on medium alignment confidence it saves a needs-confirmation candidate; with no mapping it saves a pending audio bookmark. Synthetic placeholders like `Audio extract at 123s` are prohibited. Timed transcripts of imported audiobooks/podcasts serve as anchors too.
- **Listening Sessions Actually Wired**: Sessions are created/resumed by the player, captures append to them, and they close on inactivity/content change/player close — without spawning micro-sessions. The Listening Session Inbox is mounted, receives captures, and supports full triage (Keep, Edit/Note, Flashcard, Ask Plethora, Interesting, Confusing, Discard) without duplicating already-created extracts.
- **Reliable Feedback**: `chimeVolume` and the chime-enabled flag are consumed; distinct success/failure/mode earcons; ducking restores the exact prior volume without races; playback never pauses for confirmation.
- **Duplicate Command Suppression**: Normalized events carry an event ID/source/timestamp and pass a short dedupe window so one physical press cannot produce two captures via native + web paths.
- **Provenance & Navigation**: Every resolved capture stores durable provenance (document, edition, section, source anchors, audio timestamp, capture window, session) and supports "Open in source" landing at EPUB CFI / PDF page / article anchor / transcript timestamp.
- **Performance**: Anchor lookup moves from linear scans to section-local indexed/binary search; dispatch stays synchronous and lightweight; DB writes are async; benchmark baselines updated per repo protocol.

## Capabilities

### New Capabilities
- `audio-editions`: Canonical data model, manifest persistence, lifecycle management, document-linked audio storage, source revision tracking, and backward-compatible migration from legacy audiobooks.
- `audio-edition-generation`: Semantic chapterization, progressive section-level TTS generation, provider-agnostic dispatch, voice audition preview, cost & duration estimation guardrails, per-section failure recovery, and durable background job queue.
- `audio-source-sync`: Bidirectional read/listen position synchronization, text-to-audio anchoring across document types, read-along highlighting, "Listen from here" navigation, and external audiobook pairing alignment — actually integrated into the viewers.
- `hands-free-study-mode`: Native (Android Media3; desktop media keys) and web media controls feeding one normalized dispatcher, Normal vs. Study mode profiles with per-command configurable mappings, durable background command handling, duplicate suppression, and non-intrusive audio feedback. iOS requirements are conditional on an iOS target existing.
- `audio-learning-actions`: Source-linked "Save Recent Extract" with smart sentence/paragraph boundary expansion and typed fallback outcomes, semantic markers (Bookmark, Interesting, Confusing), deferred "Ask Plethora" markers, transcript-segment extraction, and source-provenance flashcard creation.
- `listening-session-inbox`: Deferred review workflow for hands-free listening sessions, real session lifecycle management, batch triage UI, and daily listening stats aggregation.
- `listen-later-queue`: Lightweight audio queue for articles, web clippings, and document sections with lazy/immediate audio synthesis and continuous playlist playback.

### Modified Capabilities
<!-- No existing source-level capability spec requirements in openspec/specs/ are altered. Existing TTS and audiobook changes are extended into this unified framework. -->

## Impact

- **Frontend Subsystems**:
  - `src/components/viewer/AudiobookViewer.tsx`: Legacy direct media-session handlers removed; Audio Edition playback (section playlist + anchors), listening-session lifecycle, Study Mode toggle/indicator, and `RemoteMediaContext` provisioning added.
  - `src/components/settings/TTSSettings.tsx`: New Hands-Free Study Mode section (toggle, capture window, mappings, feedback).
  - `src/components/tabs/AudiobooksTab.tsx`: Actually renders document Audio Editions (removes dead imports).
  - `src/components/audio/ListeningSessionInbox.tsx`: Mounted and reachable; triage persists correctly on Tauri.
  - `src/utils/remoteMediaDispatcher.ts`, `src/hooks/useMediaSession.ts`, `src/utils/audioFeedback.ts`, `src/utils/audioEditionAnchors.ts`: Hardened per this proposal (single action enum, typed capture outcomes, dedupe, volume/race fixes, indexed lookup).
  - `src/types/audioEdition.ts` + `src/stores/settingsStore.ts`: One consistent action/command vocabulary and settings v2 with migration.
- **Backend & Native Subsystems (Rust & Mobile Plugins)**:
  - `src-tauri/src/commands/audio_editions.rs` / `audio_edition_repository.rs`: Add `update_listening_session_item`, fix `extract_count` semantics and boolean normalization, numeric-aware anchor lookup.
  - `src-tauri/plugins/plethora-android-tts/`: Upgrade to Media3 `MediaSession` + `MediaSessionService` with media-button routing, actionable notification, audio focus, durable pending-command queue with ack, and normalized event emission to the WebView.
  - `src-tauri/src/`: Desktop media-control bridge (macOS/Windows SMTC/Linux MPRIS via a Rust media-control crate) emitting normalized `remote-media-command` events plus metadata updates.
- **Data & Migration**:
  - Additive SQLite migration for the durable pending media-command queue (and any column fixes); no released migration is mutated.
  - Settings v2 migration for `handsFreeStudy` (defensive, invalid values → defaults); legacy audiobook migration invoked at startup.
- **Privacy & External APIs**:
  - Full adherence to Plethora privacy disclosures: explicit warnings before submitting document text to cloud TTS providers.
  - No microphone access or covert environmental recording; extracts are resolved from synchronized source text. No vendor-specific headphone SDKs.

## Definition of Done

This change is complete only when **all seventeen** hold:

1. A user can turn Hands-Free Study Mode on and off in the Settings UI, and via a quick toggle in the audio player, with a visible player-level indicator while active.
2. The player routes **all** media commands through the single normalized dispatcher; the legacy direct handlers in `AudiobookViewer` are gone and cannot fire.
3. With Study Mode on, a headphone **Next** (as exposed by the OS) saves a Smart Recent Extract containing **real source text** — never a placeholder.
4. The extract carries durable provenance (document ID, edition ID, section ID, source anchors, audio timestamp, capture window, session ID) and supports "Open in source" landing at the correct location.
5. Playback continues uninterrupted after a capture; success and failure each produce distinct audible feedback; `chimeVolume` and the chime-enabled setting are honored.
6. A listening session is created/resumed during Study Mode playback, receives all captures, and closes cleanly on inactivity/content change/player close — without micro-sessions.
7. The Listening Session Inbox is reachable in the app, lists captures chronologically, supports Keep / Edit note / Make Flashcard / Ask Plethora / Mark Interesting / Mark Confusing / Discard, and does not duplicate already-created extracts.
8. On Android, media commands work with the screen locked via a real Media3 media session + foreground service; a button press received while the WebView is suspended is durably queued and reconciled on resume — no silent losses.
9. One physical button press produces at most one action (native + web duplicate suppression verified).
10. Every action exposed in Settings is implemented, labeled, tested, and has a legacy-value fallback; there are no dead enum values.
11. Normal Mode preserves ordinary navigation (Next/Previous/Seek) for both editions and file-based audiobooks; disabling Study Mode restores it immediately.
12. Repeating Save Recent Extract within the extension window extends the same capture backward (update-in-place), not a duplicate.
13. Platform claims match code: Android native implementation is real; iOS is explicitly documented as not supported in this repository; desktop media keys work through the native bridge on at least macOS, with in-app keyboard fallbacks elsewhere.
14. Paired external audiobooks honor confidence tiers (high → auto extract; medium → candidate needing confirmation; low → pending bookmark).
15. All automated tests described in the specs pass, including dispatcher routing/gestures, capture boundary matrix, feedback, session lifecycle, settings migration, and player integration.
16. The performance benchmark gate passes with baselines updated in the same change if anchor-lookup costs changed intentionally.
17. The manual Android locked-screen acceptance checklist (see `specs/hands-free-study-mode/spec.md`) passes on a physical device with ordinary Bluetooth earbuds.
