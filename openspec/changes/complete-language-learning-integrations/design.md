## Context

The repository now contains profile, processing, lexicon, knowledge-state, annotation, translation, Peek, alignment, tutor, mining, video, practice, SRS, and recommendation contracts under `src/lib/` plus the corresponding language migrations and APIs. The remaining gap is host integration: the services are tested largely in isolation, while the existing EPUB/PDF/article/Queue readers, video/transcript viewers, TutorSheet/TutorComposer, Flashcard Studio, and review surfaces do not share a language-session lifecycle.

The integration must work with existing React/Tauri boundaries and preserve the invariants from the earlier changes: Language Mode is opt-in, source content is never rewritten, selection and reading/listening positions survive language actions, native audio wins over TTS, Queue/review lifecycle is not mutated, and language practice never silently creates or rates a card. The implementation must also degrade on mobile, e-ink, offline, unsupported providers, unavailable anchors, and denied permissions.

## Goals / Non-Goals

**Goals:**

- Provide one profile-scoped host context and lifecycle for all supported language surfaces.
- Make reader, video, tutor, and practice capabilities reachable through existing UI entry points.
- Preserve source anchors, provenance, stale detection, privacy policy, and capability fallbacks across navigation and reloads.
- Reuse existing playback, tutor/provider, Flashcard Studio, learning-item, Queue, and review infrastructure instead of introducing parallel runtimes.
- Persist resumable practice sessions and attempts with explicit retention, export, delete, and evidence acceptance semantics.
- Verify cross-feature behavior with deterministic fake providers, component tests, migration tests, and manual acceptance stories.

**Non-Goals:**

- Redesigning the existing reader, video, tutor, review, or Flashcard Studio visual language beyond the controls needed to expose language workflows.
- Replacing the generic scheduler, review rating flow, transcript synchronization engine, dictionary provider registry, or tutor provider runtime.
- Automatically creating learning items, changing Queue/review ratings, or sending document contents to providers without consent.
- Claiming pronunciation or phoneme accuracy when the configured provider does not advertise that capability.
- Making unsupported fixed-PDF anchors, unavailable media ranges, or provider failures appear successful.

## Decisions

### 1. Add a shared host context and controller

Create a `LanguageLearningHostContext`/controller that resolves the active profile, Language Mode setting, source identity, capability manifest, privacy policy, and current `SourceAnchor`. Reader, video, tutor, and practice hosts consume this context rather than resolving profile state independently.

**Alternative considered:** Let each surface call the language stores and services directly. This was rejected because it would duplicate profile resolution, stale handling, privacy checks, and lifecycle cleanup and would make Queue-safe behavior difficult to verify.

### 2. Use host adapters with explicit mount/unmount ownership

Define reader and media adapters for EPUB, PDF reflow/fixed, HTML/article, Markdown/text, Queue, transcript, and video. An adapter owns only presentation and anchor resolution; language services remain source-agnostic. Mounting is conditional on an explicit profile and supported capability. Unmounting cancels in-flight work and removes only language overlays/listeners.

**Alternative considered:** Mutate source DOM or inject language behavior into each reader's token renderer. This was rejected because it risks selection loss, source corruption, PDF instability, and conflicts with existing user highlight/TTS layers.

### 3. Make video integration a controller around existing playback

Wrap the existing `VideoPlayer`/`TranscriptSync` state with a language session controller keyed by media/document fingerprint. It consumes the existing current-time stream and segment identity, adds language annotations/translation/actions, and never creates a second polling loop or playback clock. Normal karaoke mode remains the default; Language Mode adds an opt-in layer.

**Alternative considered:** Build a separate language video player. This was rejected because it would fork position persistence, mobile behavior, karaoke timing, and transcript lifecycle.

### 4. Extend the existing tutor and Flashcard Studio seams

Tutor requests pass through the existing provider/session runtime with a bounded `LearnerContextPacket`, source citations, target-language instructions, and privacy decision. Language writing/correction actions reuse the same context and provider stream. Language Peek/mining sends typed drafts into the existing Flashcard Studio session rather than creating another chat or draft store.

**Alternative considered:** Create a dedicated language tutor and a separate language card editor. This was rejected because it would duplicate provider consent, session persistence, draft acceptance, and existing AI behavior.

### 5. Build one practice shell with mode adapters

Add a responsive practice shell whose state machine owns source selection, prompt/reveal state, attempt lifecycle, replay, retry, save/delete, and explicit evidence decisions. Shadowing, dictation, writing, pronunciation, and recommendation entry points implement mode adapters over the shared `PracticeAttempt`/`ProductionEvidence` contracts. The shell may be rendered as a route, sheet, or mobile full-screen surface, but the state and persistence API are shared.

**Alternative considered:** Add independent pages for every practice mode. This was rejected because it would duplicate source resolution, audio fallback, retention controls, accessibility behavior, and evidence handoff.

### 6. Keep integrations capability- and anchor-gated

Every action reports `available`, `unavailable`, `stale`, `pending`, or `failed` with a reason. Unsupported fixed-PDF mappings, missing original audio, unavailable pronunciation dimensions, and denied microphone permission degrade to a truthful alternative such as text-only practice, TTS, listen-only, or no annotation. Stale results cannot be applied to a different source occurrence.

### 7. Persist compact sessions and attempts through the existing data plane

Use profile/source/provider/model/content fingerprints for idempotency. Persist only the bounded session state, attempt comparison, provenance, retention policy, and explicit evidence decisions needed to resume and audit practice. Large source text, full documents, and recordings remain outside reactive state and follow existing local/cloud retention rules. Any schema change is a forward migration with indexes, deletion/export behavior, and recovery coverage.

### 8. Test through fake providers and cross-surface fixtures

Add deterministic fake dictionary/translation/audio/tutor/STT/pronunciation providers and canonical fixtures for Spanish EPUB, PDF reflow/fixed, HTML, Markdown, Queue, podcast transcript, YouTube transcript, and tutor/practice prompts. Component tests verify mount/unmount and accessibility; integration tests verify source identity, position preservation, provider deduplication, privacy, evidence, and no scheduler side effects. Manual acceptance covers desktop, mobile, e-ink, keyboard, touch, screen reader, reduced motion, offline, and permission-denied states.

## Risks / Trade-offs

- [Shared reader and media hosts are hot files with existing regressions] → Integrate one host family at a time behind small adapters; require focused regressions before enabling the next host.
- [Language overlays conflict with selection, search, user highlights, or TTS] → Keep language styling in a separate layer with explicit precedence and mount/unmount tests.
- [Video transcript timing drifts or duplicate polling is introduced] → Reuse the existing time source and transcript identity; add drift and cleanup tests.
- [Tutor/writing requests leak too much learner or document data] → Build the bounded context packet before provider invocation, enforce privacy policy in the host controller, and test redaction and offline paths.
- [Practice attempts become a second scheduler or create noisy evidence] → Require explicit learner actions for SRS/evidence handoff and keep review rating APIs unreachable from the practice shell.
- [Practice persistence grows with recordings or source text] → Store references, bounded summaries, fingerprints, retention metadata, and explicit deletion/export operations rather than full source payloads.
- [Capability differences produce misleading UI] → Render only provider-advertised dimensions and expose unavailable/approximate states instead of zero scores or placeholders.

## Migration Plan

1. Land shared host context, capability state, source-session identity, fake providers, and integration test fixtures without changing default UI behavior.
2. Wire reader hosts in order: text/HTML/Markdown, EPUB, PDF reflow, fixed PDF where confidence allows, Queue, then transcript-backed readers. Keep Language Mode disabled by default until each host passes regressions.
3. Wire video/transcript controls using the existing playback clock and transcript sync, then add mining and optional frame capture.
4. Wire TutorSheet/TutorComposer and document actions to bounded learner context and source-grounded output; add writing practice entry points.
5. Add the shared practice shell, then enable shadowing, dictation, writing, pronunciation, and recommendation adapters one at a time.
6. Add or extend forward migrations for resumable practice sessions/attempts and provenance only after the repository/API shape is stable. Verify fresh database, upgrade, export, delete, rollback/recovery, and large-history behavior.
7. Enable the integrations behind profile/capability flags, run cross-feature stories A–H, and only then make the controls visible in the default Language Mode surfaces.

Rollback is capability-scoped: disable the integration flag and leave existing readers, video, tutor, Flashcard Studio, Queue, and review behavior unchanged. Stored language sessions/attempts remain removable through the retention/delete path and are not required by legacy surfaces.

## Open Questions

- Should the practice shell be a dedicated top-level tab, a modal/full-screen route launched from sources, or both on desktop?
- Which existing reader host should be the first production-enabled surface after text/HTML fixtures pass: EPUB or Queue Scroll Mode?
- What frame-capture capability is available on each supported WebView, and what is the maximum retained frame size?
- Which existing tutor session persistence API should own language-specific turns if the current session schema cannot carry typed provenance?
- What are the default retention periods for typed writing, microphone recordings, and generated corrections by platform?
- Should recommendation candidates open directly into practice or first open a source preview with an explicit “Practice” action?
