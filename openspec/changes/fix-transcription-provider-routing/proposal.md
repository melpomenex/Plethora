## Why

A user who selects **Local STT + Parakeet** in Settings → Audio Transcription, then transcribes an audiobook, sees the progress panel report *"Transcribing audiobook using Groq Cloud Whisper…"*. The job is in fact running locally — the message is hardcoded — but the user has no way to know that, and no way to tell which engine ever actually ran.

Tracing that message uncovered that the mislabeling is a symptom of a broader problem: the configured provider and model are read inconsistently across the six entry points that can start a transcription, and are ignored outright by the background flows. Concretely, `provider: "groq"` from the documents list enqueues into a **local-only** worker with a model id (`groq-whisper`) that will never resolve, and podcast transcription silently substitutes whichever model happens to be installed first instead of the user's choice. The setting is presented as authoritative; today it is advisory at best.

## What Changes

**Truthful provider/model reporting**

- Every transcription progress message, CTA label, tooltip, and toast SHALL name the provider and model actually executing — never a hardcoded engine name. This covers the audiobook transcript panel, the podcast transcript panel, the podcast manager episode rows, and the documents list.
- Remove the hardcoded `"Groq Cloud Whisper"` strings in the audiobook/podcast transcript panel, the hardcoded `"Start Local Transcription"` / `"Uses Local STT"` copy shown when Groq is selected, and the hardcoded `"Transcribe with Whisper"` tooltips in the podcast manager.

**Provider and model are honored end-to-end**

- A single shared resolver decides `{ provider, modelId }` from settings + platform, and every entry point routes through it: audiobook viewer, podcast viewer, podcast manager, documents list, and Settings → "Transcribe All".
- Groq-provider work SHALL never be enqueued into the local-only auto-transcription queue. `provider: "groq"` with `modelId: "groq-whisper"` (documents list) and with a Groq model id such as `whisper-large-v3-turbo` ("Transcribe All") currently reach a worker that resolves local model paths and fail with *"Transcription model not found"*.
- Podcast transcription SHALL pass the user's resolved model instead of relying on the backend's positional "first installed profile" fallback, and the backend's hardcoded `"base"` default SHALL no longer be reachable from a user-initiated request.

**Background flows respect the settings**

- Podcast feed auto-transcribe SHALL use the configured model and language instead of passing `model: None` (which resolves to `"base"`).
- The idle scanner SHALL prefer the user's configured model rather than applying its own independent SenseVoice → Parakeet → first-installed ranking.
- The auto-transcription queue worker SHALL read the `provider` recorded on each entry rather than ignoring it, and SHALL fail an entry it cannot execute with a message naming the mismatch.

**Explicit failure instead of silent substitution**

- When the configured provider or model cannot run — Groq selected with no API key, local selected with the chosen model not downloaded — the system SHALL fail with an actionable message naming the specific blocker, and SHALL NOT silently run a different provider or model.
- Native mobile remains the one documented exception: local STT genuinely cannot run there, so mobile continues to route to Groq — but the UI SHALL state that this substitution is happening rather than presenting it as the user's selection.

**Interrupted work is resumable**

- Long audiobook transcriptions SHALL checkpoint segments as they complete and retain enough job metadata to continue after an app restart.
- A resumed job SHALL preserve the existing transcript and continue from the last persisted timestamp rather than retranscribing the file from the beginning.
- A partial transcript SHALL be identified as incomplete in the viewer and SHALL expose a "Continue transcription" action even though transcript text already exists.

**Transcript-backed Assistant sections**

- When an audiobook or podcast exposes chapters and a transcript is available, typing `#` in the Assistant SHALL list those chapters as selectable sections.
- Selecting a chapter SHALL inject only the transcript segments within that chapter's time range into the LLM context, enabling scoped questions, flashcard creation, and other Assistant tools.
- Chapter entries SHALL not be offered when no transcript text overlaps that chapter; the UI SHALL never imply that unavailable audio context was attached.

Non-goals: no changes to transcription quality, the model catalog, or the set of supported engines. No new providers. Web/PWA transcription behavior is unchanged beyond labeling.

## Capabilities

### New Capabilities

- `transcription-provider-routing`: Resolution of the effective transcription provider and model from user settings and platform constraints, uniform routing of every transcription entry point through that resolution, explicit failure when the selection cannot be honored, and truthful reporting of the engine actually in use.

### Modified Capabilities

None. No existing spec under `openspec/specs/` states requirements about transcription provider selection or model routing — `transcript-karaoke-sync` covers YouTube transcript playback sync, and `podcast-position-persistence` covers playback position only.

## Impact

**Frontend (TypeScript/React)**

- `src/components/viewer/AudiobookViewer.tsx` — `handleTranscribe` (audiobook + podcast branches), the transcript panel progress copy (~line 3221), the CTA label and helper text (~line 3251), and the start toasts.
- `src/components/assistant/AssistantPanel.tsx`, `src/components/viewer/DocumentViewerWrapper.tsx`, and the section-index utilities — accept transcript-backed chapter nodes in the existing `#` section picker and resolve them directly as LLM context.
- `src/components/media/PodcastManager.tsx` — `handleTranscribe` model resolution and the `"Transcribe with Whisper"` tooltips.
- `src/components/documents/DocumentsView.tsx` — `handleTranscribe` provider/model routing (the `"groq-whisper"` sentinel).
- `src/components/settings/AudioTranscriptionSettings.tsx` — the "Transcribe All" handler and the `preferredModelId` reconciliation effect (which today accepts an uninstalled model).
- New shared module for provider/model resolution; `src/api/transcription.ts`, `src/api/podcast.ts`, `src/api/audiobooks.ts` consume it.
- `src/lib/i18n/locales/*.ts` — `viewer.startLocalTranscription` and `viewer.usesWhisper` become provider-parameterized; all locale files need the new keys.

**Backend (Rust/Tauri)**

- `src-tauri/src/transcription/auto_queue.rs` — `process_entry` reads `entry.provider`.
- `src-tauri/src/transcription/idle_scanner.rs` — honor configured model over its own ranking.
- `src-tauri/src/commands/podcast.rs` — feed auto-transcribe passes a model; `run_transcription_job` fallback behavior.

**Tests**

- `src/components/viewer/__tests__/AudiobookViewer.test.tsx` extends with provider-routing and label cases; new unit tests for the resolver; new tests for the podcast and documents-list routing paths.

**User-visible behavior change**: transcriptions that previously completed via a silent model substitution will now fail with an actionable error until the user downloads the model they selected or changes their selection.
