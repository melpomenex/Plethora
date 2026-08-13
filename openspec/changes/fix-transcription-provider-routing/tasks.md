## 1. Shared resolver

- [x] 1.1 Create `src/lib/transcriptionProvider.ts` with the `Resolution` discriminated union from design.md Decision 1 (`ok: true` with `provider`/`modelId`/`modelLabel`/optional `substitution`, or `ok: false` with `reason` ∈ `missing-groq-key` | `model-not-installed` | `no-model-selected`).
- [x] 1.2 Implement `resolveTranscription(audioSettings, installedProfiles, platform)` as a pure function: local + installed preferred model → ok; local + preferred model not installed → `model-not-installed` naming that model; groq + no API key → `missing-groq-key`; native mobile + stored local provider → ok with `substitution: 'mobile-no-local'`; native mobile + local + no key → `missing-groq-key` with mobile wording.
- [x] 1.3 Implement `describeResolution(resolution)` returning the engine phrase (`{provider} · {model}`) used by every label, plus the disclosure sentence for `substitution: 'mobile-no-local'`.
- [x] 1.4 Move the `MODEL_QUALITY_RANK` array into this module as the single ranking source; it is used only to pick a default when no preference is set, never to override an explicit preference.
- [x] 1.5 Add `useTranscriptionResolution()` in the same module (or a sibling hook file) wrapping the pure resolver over `useSettingsStore` + `useTranscriptionStore.profiles` for components that need it during render.
- [x] 1.6 Unit tests for `resolveTranscription` covering every branch in 1.2, plus the "preference set but uninstalled while another model is installed" case (must fail, not substitute).
- [x] 1.7 Unit tests for `describeResolution` asserting a local Parakeet resolution never yields a string containing "Groq", and a Groq resolution never yields "local"/"offline".

## 2. Shared failure affordances

- [x] 2.1 Extract the "Download model" / "Go to Settings" error handling from `AudiobookImportDialog.tsx` (~lines 562-606) into a shared helper that takes a failed `Resolution` and the toast API.
- [x] 2.2 Have the helper emit the `navigate-to-settings` custom event for `missing-groq-key` and drive `downloadTranscriptionModel` + retry for `model-not-installed`, naming the exact model in both.
- [x] 2.3 Point `AudiobookImportDialog` at the shared helper and delete its local copy.

## 3. Route the user-initiated entry points through the resolver

- [x] 3.1 `AudiobookViewer.handleTranscribe` (audiobook branch): replace the inline provider/model derivation and local `MODEL_QUALITY_RANK` block (~lines 2062-2106) with the resolver; on `ok: false` call the shared failure helper and return without enqueuing.
- [x] 3.2 `AudiobookViewer.handleTranscribe` (podcast branch, ~lines 2026-2055): use the resolved model instead of `preferredModelId || "distil-small.en"`; on `ok: false` call the shared failure helper.
- [x] 3.3 `PodcastManager.handleTranscribe` (~lines 945-995): same replacement; remove the `|| "distil-small.en"` fallback so the backend never receives an unvalidated model.
- [x] 3.4 `DocumentsView.handleTranscribe` (~lines 858-920): delete the duplicated `MODEL_QUALITY_RANK` block and the `"groq-whisper"` sentinel; when the resolution is Groq, route to `transcribeAudiobookWithGroq` instead of `enqueueAutoTranscription`; when local, enqueue with the resolved model.
- [x] 3.5 `AudioTranscriptionSettings` "Transcribe All" (~lines 849-880): resolve once; when Groq, route each item to the cloud path rather than `enqueueAllUntranscribed`; when local, pass the resolved model. Settle design.md's open question here (disable the action on `ok: false`, or run and report per item).
- [x] 3.6 `AudiobookImportDialog.startTranscription` / `generateTranscript` in `src/api/audiobooks.ts`: derive the provider from the resolver rather than reading `settings.audioTranscription.provider` directly, so import-time transcription fails closed the same way.

## 4. Truthful labels

- [x] 4.1 `AudiobookViewer.tsx` transcript panel progress copy (~lines 3220-3226): replace both hardcoded "using Groq Cloud Whisper" strings with `describeResolution` output for the job actually running (podcast and audiobook branches).
- [x] 4.2 `AudiobookViewer.tsx` idle CTA (~lines 3245-3258): replace the unconditional `t("viewer.startLocalTranscription")` and `t("viewer.usesWhisper")` with provider-parameterized keys fed by the resolver; keep the existing mobile-specific label path but source its provider name from the resolver.
- [x] 4.3 `AudiobookViewer.tsx` start toasts (lines 2119 and 2142): name the resolved provider and model in both the Groq and local branches.
- [x] 4.4 `PodcastManager.tsx` transcribe tooltips (lines 1601 and 1901): replace `title="Transcribe with Whisper"` with the resolved engine phrase.
- [x] 4.5 Render the `substitution: 'mobile-no-local'` disclosure sentence in the transcript panel on native mobile so the cloud provider is not presented as the user's selection.
- [x] 4.6 Add the new parameterized i18n keys to `en.ts`, then to `de.ts`, `es.ts`, `fr.ts`, `ja.ts`, `zh.ts`; remove `viewer.startLocalTranscription` and `viewer.usesWhisper` once no call sites remain.

## 5. Settings view reflects installation state

- [x] 5.1 `AudioTranscriptionSettings.tsx` (~lines 168-176): change the `preferredModelId` reconciliation so it no longer accepts a catalog entry that is not installed as a silently-valid preference.
- [x] 5.2 Mark a not-installed preferred model in the model dropdown and adjacent copy, with a download action; do not auto-switch the selection.
- [x] 5.3 Relabel the queue section to state that it is the local transcription queue (per design.md Decision 3's consequence).

## 6. Settings mirror for background flows

- [x] 6.1 Add a `transcription_config` key to the Rust side (`provider`, `preferred_model_id`, `language`) with read/write commands following the `auto_postpone_config` pattern in `src-tauri/src/commands/postpone.rs`. Do not include the Groq API key.
- [x] 6.2 Register the new commands in `src-tauri/src/lib.rs`.
- [x] 6.3 Write the mirror from the frontend on app boot and on every change to `settings.audioTranscription`.
- [x] 6.4 Rust helper that reads and parses the blob, returning `None` on missing/unparseable so callers skip rather than substitute.

## 7. Backend honors provider and model

- [x] 7.1 `auto_queue::process_entry` (`src-tauri/src/transcription/auto_queue.rs`, ~line 191): read `entry.provider` before resolving a model path; fail the entry with an error naming the provider mismatch when it is not `local`, and continue with the next entry.
- [x] 7.2 `idle_scanner.rs` (~lines 87-130): read the mirrored config and use the configured model; when the configured model is not installed or the mirrored provider is not `local`, skip and log instead of applying the current SenseVoice → Parakeet → first-installed ranking.
- [x] 7.3 `podcast.rs` feed auto-transcribe (~lines 216-243): pass the mirrored model and language into `run_transcription_job` instead of `model: None`.
- [x] 7.4 `podcast.rs` `run_transcription_job` (~lines 411, 549-570): remove the unconditional `"base"` default and replace the "first installed profile" fallback with an error naming the requested model.
- [x] 7.5 `audiobook.rs` `generate_audiobook_transcript` (~lines 710-722): replace the "first installed profile" fallback with an error naming the requested model.

## 8. Tests

- [x] 8.1 Extend `src/components/viewer/__tests__/AudiobookViewer.test.tsx`: with local + Parakeet resolved, the in-progress panel names Parakeet and contains no "Groq"; with Groq resolved, it names Groq and contains no "local"/"offline".
- [x] 8.2 Test in the same file that the idle CTA label changes when the configured provider changes.
- [x] 8.3 Test that a local provider with an uninstalled preferred model does not enqueue and surfaces the named-model error.
- [x] 8.4 New test for `DocumentsView.handleTranscribe`: Groq provider routes to the cloud path and creates no local queue entry; local provider enqueues with the resolved model.
- [x] 8.5 New test for `PodcastManager.handleTranscribe`: the resolved model is passed through, and Parakeet is used when installed alongside a Whisper model.
- [x] 8.6 Rust test for `auto_queue::process_entry` rejecting a non-local entry with a provider-mismatch error without attempting a model-path lookup.
- [x] 8.7 Rust test that `run_transcription_job` errors naming the requested model rather than substituting an installed one.

## 9. Verification

- [x] 9.1 Run `npm run test` (or the project's vitest command) and confirm the full frontend suite passes.
- [x] 9.2 Run `cargo test` in `src-tauri/` and confirm the Rust suite passes.
- [x] 9.3 Run the linter and type check; confirm no unused-import or dead-code warnings remain from the deleted `MODEL_QUALITY_RANK` blocks and removed i18n keys.
- [ ] 9.4 Manual desktop pass: select Local STT + Parakeet, transcribe an audiobook, confirm the panel names Parakeet throughout and the transcript lands.
- [ ] 9.5 Manual desktop pass: select Local STT + Parakeet, transcribe a podcast episode, confirm the same and that Parakeet (not the first installed model) actually ran.
- [ ] 9.6 Manual desktop pass: select Groq, transcribe from the documents list and from "Transcribe All", confirm no "Transcription model not found" failure and that the labels say Groq.
- [ ] 9.7 Manual desktop pass: select a model that is not downloaded, start a transcription, confirm the error names that model and the download action works and retries.

## 10. Resumable audiobook transcription

- [x] 10.1 Add a migration and model/repository support for `transcription_queue.chapter_id`, defaulting legacy/document-wide jobs to `document_id`.
- [x] 10.2 Change the auto queue to preserve existing transcript rows/segments, derive the resume timestamp from the last persisted segment, prepare only the remaining audio, and offset new segments onto the original timeline.
- [x] 10.3 Preserve checkpoint progress across restart/retry and automatically process queue entries reset from `processing` to `pending` during startup.
- [x] 10.4 Route local audiobook viewer transcription through the persistent auto queue with the active transcript chapter id.
- [x] 10.5 Retain transcript status and loaded chapter id in `useTranscriptionStore`; render partial transcript status and a provider-aware "Continue transcription" action when segments exist but completion has not been recorded.
- [x] 10.6 Make Groq audiobook transcription preserve existing segments, skip already completed chunks, and rebuild final document text from the full persisted transcript.
- [x] 10.7 Add i18n copy for partial/resume state to all supported locale files.
- [x] 10.8 Add Rust regression tests for resume timestamp/offset behavior, queue chapter persistence, and startup reset progress preservation.
- [x] 10.9 Add frontend tests proving a partial transcript remains visible and exposes a continue action that enqueues the same chapter.
- [x] 10.10 Run targeted frontend/Rust tests plus linter and type check.

## 11. Transcript-backed Assistant sections

- [x] 11.1 Extend `SectionNode`/`AssistantContext` with an authoritative media-transcript section source that can be injected without document-heading reconciliation.
- [x] 11.2 Build transcript-backed chapter nodes by intersecting audiobook/podcast chapter time ranges with persisted timestamped transcript segments, omitting chapters without transcript coverage.
- [x] 11.3 Publish media chapter nodes from `AudiobookViewer` through `DocumentViewer` and `DocumentViewerWrapper` into the existing Assistant panel.
- [x] 11.4 Allow `#` to list/filter/select media transcript chapters and inject their content into the LLM context while preserving normal Assistant tool/flashcard behavior.
- [x] 11.5 Add tests for chapter/segment intersection, empty/untranscribed chapter omission, `#` picker population, and chapter-only LLM context injection.
