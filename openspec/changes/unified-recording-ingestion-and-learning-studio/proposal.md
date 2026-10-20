## Why

Plethora has useful recording, transcription, extraction, AI generation and review systems, but users must connect them themselves. Recorded lectures currently have unsafe persistence and lose structured transcript metadata; imported recordings do not arrive in a coherent learning workspace. This change makes both origins follow one recoverable, source-grounded journey.

## What Changes

- Introduce **Capture & Import**: Record Audio, Import Recording, Import Transcript and Import Supported URL, converging on an ordinary library document with an attached recording session.
- Save recording data incrementally, before inference; recover committed audio after interruption and restart. Replace the separate Apple text-only lecture entry path with the shared session workflow.
- Extend existing transcription orchestration and persistence with stable segment identities, optional timing, speaker/word metadata, durable provider-aware job dispatch and failure-safe checkpoints.
- Provide a responsive Learning Studio with Overview, Transcript, Extracts, Flashcards and an existing-Assistant handoff. Playback, transcript corrections, search, selections and source navigation work independently of generation.
- Analyze bounded transcript sections through the existing AI task infrastructure. Produce grounded outlines, concepts, summaries and extract/card proposals using configurable content profiles.
- Persist suggestions outside `learning_items`; explicit acceptance atomically creates ordinary extracts/cards and source provenance. Rejection and retries never activate cards or reset existing review history.
- Reuse collections, tags, library search, the semantic index, Flashcard Studio editors and FSRS. Keep legacy generation APIs compatible; the new flow must not call APIs that persist before approval.

## Capabilities

### New Capabilities

- `recording-sessions`: Shared ingestion identity, assets, import lifecycle, transcript-only sessions, organization and retention.
- `durable-recording-capture`: Incremental capture, microphone ownership, recording state machine and recovery.
- `session-learning-analysis`: Bounded hierarchical analysis, content profiles, durable suggestions and duplicate reconciliation.
- `session-learning-studio`: End-to-end workspace, seven screen contracts, honest states and platform-adaptive interactions.

### Modified Capabilities

- `media-ingestion-transcription`: Common session ingestion, canonical transcript metadata and permission-aware sources.
- `transcription-jobs`: Session-bound durable dispatch, truthful progress, checkpoint transactions and cancellation.
- `audio-learning-actions`: Recording markers, transcript selection and provenance navigation.
- `ai-learning-material-generation`: Durable session drafts, atomic acceptance and existing-card preservation.
- `flashcard-studio-sessions`: External durable draft adapter alongside existing local Studio workspaces.
- `transcript-search-integration`: Canonical session transcript indexing and precise/coarse navigation.
- `apple-speech-transcription`: Shared durable lecture capture and explicitly selected session enrichment.
- `android-speech-intelligence`: Shared recording/file pipeline and bounded native speech input.

## Impact

Existing capture hosts, command registry, document import/share handoff, transcription queue/manager/adapters, transcript readers, source resolvers, Flashcard Studio and AI indexer gain small integration boundaries. New session repositories, asset writer and analysis coordinator supply missing ownership; they do not replace provider registries, media players, the scheduler or Assistant. SQLite changes are primarily additive, with one explicitly tested rebuild of `transcript_segments` to allow genuinely untimed segments. No new provider, payment system, organization hierarchy or general agent framework is introduced.

### Current and proposed experience

Today: platform-dependent lecture commands or import → unrelated player/transcription controls → separate extract inbox/Studio; some apparent drafts are already saved cards. Proposed: capture/import → durable session immediately → transcript and playback progressively available → optional study suggestions → edit/approve selected → existing review queue → Open in Source.

### User stories and value

- As a student, I can record class, leave the screen and recover saved audio even when transcription fails.
- As an importer, I receive the same learning tools for an external MP3, video or transcript, with honest differences in available media and timing.
- As a meeting participant, I get decisions and action items without unwanted flashcards.
- As a learner, I can inspect evidence before accepting a card and return to it during ordinary review.
- As a privacy-conscious user, I can keep a session local, see the actual processor and defer AI entirely.

### Scope, goals and non-goals

P0 establishes reliable capture/import and manual transcript learning, then a small analyzed vertical slice. P1 completes draft review, organization and grounded Assistant integration. P2 adds the explicitly enumerated refinements in tasks.md. Every phase remains usable. System-audio recording, video-camera capture, DRM bypass, arbitrary URL downloading, new STT models, automatic graph rewriting, automatic cross-session card merging and universal background execution are out of scope. Browser/PWA receives explicit unsupported/degraded states until its durable storage adapter passes its gates; desktop and native Android/iOS are the release targets.

### Dependencies and ownership

The baseline is `615570ff0301b97db7a27beec3d63db3fd04de89` on 2026-10-20. Existing untracked AI completion proposals are inputs, not implementations. `audit.md` identifies overlaps with provider-routing, Android STT, GPU runtime, source-return navigation and AI completion changes. Reuse their public contracts if landed; otherwise implement only the narrowly specified session adapters here. Optional Learning Agent integration and concept graph work are not prerequisites for recording, analysis or approval. See implementation-guide.md for landing order and shared-file ownership.

### Risks and acceptance criteria

Highest risks are media loss during filesystem/DB failure, codec-dependent recovery, nullable-timing compatibility, native lifecycle behavior, competing job consumers and acceptance/provenance atomicity. Feature flags gate exposure; disabling them retains media and permits recovery/export. Completion requires all 18 journeys in validation.md, phase checkpoints and the regression matrix. No real-device pass is claimed by this proposal. The documentation-only validation results and one existing baseline test failure are recorded there.

## Deliverables and reading order

Read `audit.md`, `design.md`, `ux.md`, `implementation-guide.md`, `tasks.md`, then the formal deltas under `specs/`. `validation.md` maps every mandatory journey to deterministic fixtures and device evidence. All implementation checkboxes remain unchecked: this change is an implementation blueprint, not feature implementation.
