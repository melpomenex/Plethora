## 1. Baseline and shared integration contracts

- [x] 1.1 Audit the existing reader, Queue, video/transcript, tutor, Flashcard Studio, review, and practice hosts and record the exact hot-file ownership before implementation.
- [x] 1.2 Add the shared `LanguageLearningHostContext` and controller for active profile, Language Mode, source identity, capability state, privacy policy, lifecycle cancellation, and stale-result rejection.
- [x] 1.3 Add shared host action/result types for pending, available, unavailable, stale, failed, cancelled, and explicit evidence/SRS handoff states.
- [x] 1.4 Add deterministic reader, media, tutor, STT, pronunciation, translation, and provider fakes plus Spanish EPUB/video/practice fixtures.
- [x] 1.5 Add unit tests for profile switching, host mount/unmount cleanup, source fingerprint changes, privacy gating, capability fallbacks, and no-op behavior when Language Mode is off.

## 2. Reader host integration

- [x] 2.1 Wire the host context into HTML/article, Markdown, and plain-text readers using existing selection and source-anchor adapters.
- [x] 2.2 Wire EPUB annotations, Language Peek, sentence translation, Sentence Mode entry, reading assist, and original-audio-first replay without mutating EPUB source content.
- [x] 2.3 Wire PDF reflow annotations/actions and fixed-PDF canonical-word confidence gating; skip ambiguous spans while preserving selection and position.
- [x] 2.4 Wire Queue Scroll Mode and transcript-backed reader surfaces without changing Queue lifecycle, ranking, completion, dismissal, or reading position.
- [x] 2.5 Implement annotation precedence with user highlights, search, TTS word highlighting, selection, and e-ink/reduced-motion styles.
- [x] 2.6 Add reader-level Language Peek actions for state change, explicit Memorize, Extract, translation, sentence replay, Explain, and practice entry.
- [x] 2.7 Add reader integration tests for EPUB, PDF fixed/reflow, HTML/article, Markdown, Queue, transcript selection, profile switching, stale anchors, and Language Mode off.
- [x] 2.8 Add keyboard, touch, screen-reader, contrast, mobile, and e-ink tests for reader language controls.

## 3. Video and transcript integration

- [x] 3.1 Add the video language session controller around the existing player clock, transcript sync, and progress persistence without a second timer or position store.
- [x] 3.2 Mount language sentence/token annotations, translations, Language Peek, Sentence Mode, replay, and profile state into YouTube and local video transcript surfaces.
- [x] 3.3 Preserve normal karaoke auto-follow and word timing while layering language state and approximate/unavailable timing labels.
- [x] 3.4 Add explicit sentence mining with bounded transcript context, timestamp provenance, media fingerprint, and optional capability-gated frame capture.
- [x] 3.5 Add stale transcript/media/analysis invalidation, provider failure/retry, offline, unavailable audio, and Language Mode exit behavior.
- [x] 3.6 Add video/transcript component and integration tests for playback drift, cleanup, mobile controls, keyboard access, karaoke coexistence, mining provenance, and ordinary playback.

## 4. Tutor and writing host integration

- [x] 4.1 Integrate bounded `LearnerContextPacket` construction into TutorSheet, TutorComposer, document assistance, Language Peek Explain, and source-grounded tutor entry points.
- [x] 4.2 Add language tutor modes for explanation, conversation, target-vocabulary practice, correction, and source-grounded answers using the existing provider/session runtime.
- [x] 4.3 Add target-language instructions, lexical targeting, source citations, freshness labels, streaming cancellation, retry, and typed unavailable/error states.
- [x] 4.4 Wire privacy consent, local/BYO/cloud provider selection, redaction, retention, delete/export, offline behavior, and provider capability disclosure.
- [x] 4.5 Add writing-practice prompt entry points, raw learner text preservation, correction modes/categories, editable feedback, and explicit active-evidence/SRS handoff.
- [x] 4.6 Add tutor and writing component tests for bounded context, source grounding, stale sources, provider failures, cancellation, consent, raw-text preservation, and evidence acceptance.

## 5. Shared practice screen and session lifecycle

- [x] 5.1 Implement the responsive language practice shell with source/session state, prompt/reveal state, replay, retry, save/delete, exit, and mode routing.
- [x] 5.2 Add reader, Sentence Mode, video/transcript, tutor, Language Peek, and recommendation entry points that preserve source anchor and originating surface.
- [x] 5.3 Add compact practice-session/attempt persistence and API support for profile/source/provider/model fingerprints, comparison summaries, retention, export, delete, and recovery.
- [x] 5.4 Add explicit evidence acceptance and shared SRS draft handoff while ensuring attempts cannot rate, reschedule, complete, or silently create learning items.
- [x] 5.5 Add shared practice shell tests for resume, discard confirmation, source-position restoration, duplicate submission protection, stale results, and Queue/review isolation.

## 6. Practice modes

- [x] 6.1 Wire shadowing listen-first, immediate, and continuous flows with microphone capability/permission, start/stop/cancel/delete, local/cloud STT, confidence, retry, and original-audio/TTS fallback.
- [x] 6.2 Wire dictation hidden-answer flow with normalized comparison, raw-answer preservation, missing/extra/substituted/order errors, reveal, replay, retry, and offline text practice.
- [x] 6.3 Wire writing prompts from documents/interests/lexicon with bounded tutor context, correction modes, provider streaming, local draft recovery, and explicit production evidence.
- [x] 6.4 Wire pronunciation feedback from shadowing attempts using capability-gated transcription, word confidence, timing/rhythm, model, and phoneme dimensions without fabricated scores.
- [x] 6.5 Wire recommendation candidates into practice previews with coverage/difficulty explanations, duplicate suppression, and explicit start actions.
- [x] 6.6 Add mode-specific tests for normalization, uncertainty, permissions, provider mismatch, stale results, retention, deletion, privacy, and no-audio fallback.

## 7. Existing-surface compatibility and migrations

- [x] 7.1 Extend transcript karaoke synchronization to consume language state without changing its existing clock, auto-follow, or word timing requirements.
- [x] 7.2 Extend YouTube playback controls with opt-in Language Mode while preserving inline playback and progress persistence.
- [x] 7.3 Verify Review sessions remain flashcard-only and practice attempts never invoke review rating or Queue mutation paths.
- [x] 7.4 Extend Flashcard Studio sessions to accept language Peek/mining drafts with source/provenance metadata and stale confirmation.
- [x] 7.5 Add forward migrations or repository extensions for compact integration session/attempt/provenance data with indexes, export/delete, retention, upgrade, recovery, and large-history tests.
- [x] 7.6 Run fresh-database and existing-database migration checks and verify rollback/recovery behavior before enabling persistence flags.

## 8. Cross-feature verification and rollout

- [x] 8.1 Add Spanish EPUB acceptance coverage: profile selection, state annotations, Peek, morphology/translation fallback, explicit state change, replay, Memorize, and no automatic card creation.
- [x] 8.2 Add repeated-word coverage: encounter/lookup evidence, unobtrusive Memorize, rich Studio draft, duplicate policy, and existing scheduler reuse.
- [x] 8.3 Add Sentence Mode coverage: translation reveal, vocabulary inspection, tutor explanation, original/TTS replay, loop, and exact return anchor.
- [x] 8.4 Add podcast/audio and YouTube coverage: transcript analysis, alignment, lexical highlighting, original replay, timestamp/frame mining, and normal playback invariants.
- [x] 8.5 Add Queue coverage: profile-specific coverage/difficulty signal, 92–98% preference behavior where configured, and unchanged Queue semantics.
- [x] 8.6 Add tutor and active/passive evidence coverage: bounded context, source grounding, privacy fallback, reading recognition, dictation/writing/speaking production evidence.
- [ ] 8.7 Run TypeScript/Vitest, Rust tests, `npx tsc --noEmit`, `npm run test:scripts`, `npm run bench:check`, accessibility checks, and reader/video regression suites.
- [ ] 8.8 Run `openspec validate complete-language-learning-integrations --strict`, review the diff for hot-file ownership, and enable integrations behind profile/capability flags only after all gates pass.
