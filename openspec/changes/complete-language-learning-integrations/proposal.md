## Why

The language-learning contracts and services now exist, but several capabilities are not reachable from the product surfaces where learners work. Reader annotations and Language Peek are not consistently mounted across document hosts, video learning is not connected to transcript/playback controls, tutor context is not exposed through the existing tutor flows, and shadowing, dictation, writing, pronunciation, and recommendation services do not yet share a usable practice screen.

This change completes the product wiring so the existing language services become opt-in, source-grounded workflows while preserving ordinary reading, playback, Queue behavior, privacy controls, and the existing scheduler.

## What Changes

- Add a shared language-learning host controller for profile resolution, Language Mode enablement, source anchors, stale-state handling, and capability-aware fallback.
- Mount vocabulary annotations, Language Peek, sentence translation, sentence mode, reading assist, and original-audio replay across EPUB, PDF reflow/fixed, HTML/article, Markdown/text, Queue, and transcript readers where anchors are reliable.
- Add a video Language Mode host that synchronizes transcript sentences, token states, translations, sentence replay, mining actions, optional frame capture, and normal video/karaoke behavior.
- Connect the existing tutor sheet/composer and document actions to the bounded learner context, source grounding, language targets, correction modes, provider/privacy settings, and streaming/error states.
- Build a responsive language practice screen with shared source/session state and separate modes for shadowing, dictation, writing, pronunciation feedback, and recommendation-driven practice.
- Add explicit practice entry points from readers, Sentence Mode, video/transcript surfaces, Language Peek, tutor output, and recommendations without automatically creating cards or rescheduling review items.
- Add durable session/attempt persistence, retention/delete/export behavior, active/passive evidence acceptance, and analytics events through the existing language APIs.
- Add desktop, mobile, e-ink, keyboard, touch, screen-reader, reduced-motion, offline, provider-failure, and permission-denied fallbacks.
- Add integration tests and manual acceptance coverage for the Spanish EPUB, podcast/audio, YouTube/video, tutor, and active/passive vocabulary stories.

## Capabilities

### New Capabilities

- `language-reader-host-integration`: Mounts the existing language annotation, Peek, translation, sentence, assist, and audio services into supported reader hosts while preserving selection and reading position.
- `language-video-host-integration`: Connects video/transcript playback, language annotations, translation, sentence actions, original media alignment, and sentence mining.
- `language-tutor-host-integration`: Integrates learner-aware language context, source grounding, lexical targeting, corrections, and privacy/provider states into existing tutor and document-assistance flows.
- `language-practice-screen`: Provides a shared practice shell and mode adapters for shadowing, dictation, writing, pronunciation feedback, and recommendation-driven practice.

### Modified Capabilities

- `transcript-karaoke-sync`: Preserve normal karaoke timing while adding opt-in language sentence/token state and practice actions.
- `youtube-playback`: Add language-session controls and source-preserving transcript/video actions without changing ordinary playback semantics.
- `flashcard-review-session`: Allow explicit language-practice evidence and handoff actions without changing rating, rescheduling, or completion behavior.
- `flashcard-studio-sessions`: Accept language Peek/mining/practice drafts with provenance and explicit learner acceptance.

## Impact

- Reader hosts and selection surfaces under `src/components/viewer/`, `src/components/tabs/`, `src/pages/QueueScrollPage.tsx`, and `src/components/viewer/selectionInteraction/`.
- Video/transcript hosts under `src/components/video/`, `src/components/media/`, `src/components/viewer/`, and existing playback synchronization modules.
- Tutor and AI surfaces under `src/components/tutor/`, tutor/provider APIs, document context actions, and privacy/settings stores.
- New practice UI under `src/components/language/` or the existing review/practice surface, shared session hooks, and mobile/e-ink layouts.
- Integration APIs for language profile, annotation, Peek, translation, alignment, mining, tutor context, practice attempts, evidence, recommendations, and SRS drafts.
- SQLite repositories/migrations for resumable practice sessions, attempts, provider/provenance metadata, retention, and export/delete; existing language migrations remain the source of shared identity and state.
- Vitest component/integration tests, Rust repository/command tests, reader/video regression tests, accessibility tests, and performance benchmarks.

