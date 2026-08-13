## Context

See proposal.md — Why. The constraints that shape the approach:

**Six entry points, six independent resolutions.** `AudiobookViewer.handleTranscribe` (audiobook branch), `AudiobookViewer.handleTranscribe` (podcast branch), `PodcastManager.handleTranscribe`, `DocumentsView.handleTranscribe`, `AudioTranscriptionSettings` "Transcribe All", and `AudiobookImportDialog` each read `settings.audioTranscription` and derive a provider/model themselves. Two of them apply a `MODEL_QUALITY_RANK` fallback (duplicated verbatim in `AudiobookViewer.tsx:2077` and `DocumentsView.tsx:877`); the podcast paths apply none and lean on a backend fallback instead. The labels are written independently of all of this, which is why they drifted.

**Three execution paths already exist and work.** Local desktop → `start_transcription` (job_queue) or `enqueue_auto_transcription` (auto_queue); Groq audiobook → `transcribe_audio_file_groq`; Groq podcast → `transcribe_podcast_groq_chunks`. All three correctly dispatch `parakeet-*` / `sense-voice-*` / Whisper by model-id prefix. Nothing is wrong with the engines — the defect is entirely in which path gets chosen and what the user is told.

**Rust background flows cannot see the settings.** `audioTranscription` lives in the Zustand store persisted to `localStorage["incrementum-settings"]`. The idle scanner (`idle_scanner.rs`) and podcast feed auto-transcribe (`podcast.rs:216`) run entirely in Rust with no frontend involvement, so today they invent their own model choice. The existing workaround for the Groq key — reading `localStorage` in TS and passing it as a command argument (`audiobooks.ts:726`) — only works for frontend-initiated calls.

**The local worker ignores the provider it records.** `TranscriptionQueueEntry` has a `provider` column, `enqueue_auto_transcription` persists it, and `auto_queue::process_entry` never reads it — it goes straight to `model_manager.get_model_path(&entry.model_id)`.

## Goals / Non-Goals

**Goals:**

- One resolution of `{ provider, modelId }` per transcription request, shared by the routing decision and every label describing it — so the two cannot drift again.
- Make the local queue's `provider` column load-bearing.
- Give the Rust background flows a supported way to read the user's transcription settings.
- Fail closed with a named blocker and an actionable affordance.

**Non-Goals:**

- Teaching the local auto-transcription queue how to run Groq jobs. See Decision 3.
- Unifying the three execution paths behind one command. They differ meaningfully (streaming segments vs. batch, chunked upload vs. local file) and consolidating them is a separate refactor.
- Moving the Groq API key out of frontend storage.
- Changing the model catalog, engine dispatch, or transcription quality.

## Decisions

### 1. Resolution lives in TypeScript, in one module

New `src/lib/transcriptionProvider.ts` exports a pure function over `(settings.audioTranscription, installedProfiles, platform)` returning a discriminated union:

```
type Resolution =
  | { ok: true; provider: 'local' | 'groq'; modelId: string; modelLabel: string;
      substitution?: 'mobile-no-local' }
  | { ok: false; reason: 'missing-groq-key' | 'model-not-installed' | 'no-model-selected';
      modelId?: string; modelLabel?: string }
```

`modelLabel` is the display name from the model profile (or the Groq model name), so labels never re-derive it from the id. A companion `describeResolution(resolution)` produces the user-facing engine phrase used by every progress message, CTA, tooltip, and toast.

*Why TypeScript, not Rust:* four of the five user-initiated entry points are React components that need the resolution **synchronously during render** to label a button before anything is invoked. The settings and the Groq key both already live in the frontend. Resolving in Rust would mean an async round-trip on every render and would require the settings mirror (Decision 2) as a prerequisite for the *foreground* paths too, not just the background ones.

*Why pure over a hook:* `DocumentsView` and the settings "Transcribe All" call it from event handlers, not render. A thin `useTranscriptionResolution()` hook wraps it for the components that need reactivity.

*Alternative considered — leave resolution distributed, fix only the labels:* rejected. The labels drifted precisely because they were written next to, but not from, the routing decision. Any fix that keeps them separate re-opens the same gap on the next edit.

### 2. Mirror the transcription config into `app_settings` for background flows

The frontend writes a `transcription_config` JSON blob (`provider`, `preferredModelId`, `language`) into the existing key/value `app_settings` table on app boot and on every change to `settings.audioTranscription`. `idle_scanner` and the podcast feed auto-transcribe read it via `repo.get_setting`.

This follows the established convention in this codebase — `auto_postpone_config` (`commands/postpone.rs`), `tas_config` (`commands/tas.rs`), `backup_scheduler` (`commands/scheduler.rs`) all use exactly this pattern.

**The Groq API key is deliberately excluded from the mirror.** Background flows therefore remain local-only: if the mirrored provider is `groq`, the background flow skips the item and records why, rather than duplicating the key into the database. Background Groq transcription is a separate feature decision, not a bug fix.

*Alternative considered — pass settings as command arguments:* works for foreground calls (and is what `transcribe_audio_file_groq` already does), but the background flows have no frontend caller to pass anything.

*Alternative considered — have Rust read `localStorage` directly:* not reachable from the Rust side; the WebView storage is not exposed as a file the backend can reliably parse across the three platforms.

### 3. The local worker rejects non-local entries; it does not learn a Groq path

`auto_queue::process_entry` gains an early check: if `entry.provider != "local"`, fail the entry with an error naming the mismatch and move on. The frontend stops creating such entries in the first place (`DocumentsView` and "Transcribe All" route Groq work to `transcribe_audio_file_groq`), so the check is a backstop for entries already sitting in the queue from the current buggy build.

*Why not add a Groq branch to the worker:* the working Groq path already handles chunked upload, rate-limit accounting, and per-chunk retry (`podcast.rs:1054` `split_audio_bytes_into_groq_chunks`, `groqTranscription.ts` usage tracking). Reimplementing that inside the queue worker is a large change with no user-visible benefit over routing to the existing command. Recorded as a possible follow-up if background Groq transcription is ever wanted — at which point Decision 2's key exclusion would also need revisiting.

*Consequence:* the auto-transcription queue is now explicitly the **local** queue. Its name and the settings UI copy should say so.

### 4. Fail closed, with exactly one disclosed exception

The resolver returns `ok: false` rather than substituting. Each entry point renders the failure with the affordance that matches the reason:

- `missing-groq-key` → error naming Groq, with a "Go to Settings" action (the `navigate-to-settings` custom event already exists at `AudiobookImportDialog.tsx:562`).
- `model-not-installed` → error naming the model, with a "Download model" action (already implemented at `AudiobookImportDialog.tsx:578-604`; lift it to a shared handler).

Native mobile is the single exception: `isNativeMobile()` with a stored `local` provider resolves to `{ ok: true, provider: 'groq', substitution: 'mobile-no-local' }`, and every label built from that resolution states the substitution rather than presenting Groq as the user's choice. If no key is configured, it resolves to `missing-groq-key` with mobile-specific wording (that wording already exists at `PodcastManager.tsx:975`).

The backend fallbacks that currently substitute silently (`audiobook.rs:711-722`, `podcast.rs:549-570` — both "first installed profile in catalog order") become errors that name the requested model. `run_transcription_job`'s unconditional `"base"` default (`podcast.rs:411`) is removed; the model becomes required for user-initiated requests and comes from the mirror for background ones.

### 5. The preferred-model setting is reconciled against *installed*, not *known*, models

`AudioTranscriptionSettings.tsx:168-176` currently keeps `preferredModelId` if it merely appears in the profile catalog. Since `distil-small.en` is the shipped default and is in the catalog, a user who downloads only Parakeet keeps an uninstalled model as their "preference" — which is how a podcast can silently run a model the user never picked.

The fix is to **surface** the state, not auto-correct it: the settings view marks a not-installed preference and offers to download it. Auto-switching the selection would itself be a silent substitution, contradicting Decision 4.

### 6. Engine names come from parameterized i18n keys

`viewer.startLocalTranscription` and `viewer.usesWhisper` are replaced by parameterized keys taking the engine phrase from `describeResolution`. All six locale files (`de`, `en`, `es`, `fr`, `ja`, `zh`) get the new keys; untranslated locales fall back to English via the existing mechanism.

### 7. Audiobook transcription is checkpointed and resumes by timestamp

Local audiobook work started from the viewer moves from the in-memory `JobQueue` to the persisted `transcription_queue`. Queue entries carry the transcript `chapter_id` as well as the document id, so an interrupted job can target the same transcript row after restart. Existing callers that transcribe an entire media document default `chapter_id` to the document id.

The worker upserts the transcript's status and metadata without replacing its row or deleting `transcript_segments`. Before preparing audio it reads `MAX(end_ms)` for that transcript. If the transcript is incomplete and has saved segments, FFmpeg prepares only the remaining audio beginning at that timestamp; emitted segment timestamps are offset back onto the original audiobook timeline. Progress from the remaining portion is mapped into the saved queue progress rather than jumping back to zero.

On startup, queue entries left in `processing` are reset to `pending` without clearing their progress, and queue processing is triggered automatically. The same checkpoint behavior applies to explicit retry/continue. Groq audiobook chunking follows the equivalent rule: preserve existing rows, skip chunks ending before the saved timestamp, and assemble final document text from all persisted segments.

The frontend retains the loaded transcript's `status` and chapter id. A transcript with segments and any status other than `completed` is rendered as partial and includes a provider-aware "Continue transcription" action. The action queues the same document/chapter pair; it does not require deleting the partial transcript first.

*Why timestamp rather than chunk index:* transcript segments already persist their original timeline and work for local and cloud engines. A timestamp requires no engine-specific checkpoint schema, survives model implementation changes, and makes existing partial transcripts resumable.

*Why retain an explicit action if startup auto-resumes:* old in-memory jobs have no persisted queue entry, and failed/cancelled jobs should not restart without user intent. The action repairs both cases while automatic resume handles a normal restart of a persisted processing job.

### 8. Media chapters enter the existing Assistant section pipeline as authoritative nodes

The Assistant already has a lazy `#` section picker based on `SectionNode`. Audiobook/podcast integration SHALL reuse that path rather than add a second mention syntax or a media-specific chat surface. `AssistantContext` gains optional authoritative section nodes supplied by the active viewer. When present, the panel uses those nodes instead of parsing headings from the flattened `documents.content` transcript.

`AudiobookViewer` builds one node per real chapter by selecting persisted transcript segments whose timestamps overlap `[chapter.startTime, chapter.endTime)`. Node content is the joined transcript for that range; the title and hierarchy come from the media chapter metadata. Chapters without overlapping transcript text are omitted. A callback through `DocumentViewer`/`DocumentViewerWrapper` publishes the nodes to the Assistant context. The same shape supports podcast chapters when a feed/episode provides them; episodes with no chapter metadata continue to expose only their ordinary full transcript context.

Selected media nodes are self-contained: their `content` is already the canonical chapter transcript. The Assistant therefore injects the selected nodes directly through `buildSelectionFocusedContext`/the focused-context budget path instead of refetching `documents.content` and attempting to reconcile character offsets. The existing tool-capable chat path remains unchanged, so requests such as "create flashcards from #Chapter 4" receive the scoped chapter transcript and may call the normal flashcard tools.

*Why timed overlap:* transcription engines emit timestamped segments while chapter metadata is also time-based. Joining on time is stable across wording changes and works for imported/generated transcripts without inserting artificial Markdown headings into stored document content.

*Why omit empty chapters:* a chapter title alone is not evidence that the transcript for that range exists, particularly while a resumable transcript is still partial. Hiding unavailable chapters prevents the Assistant from silently falling back to unrelated context.

## Risks / Trade-offs

**Transcriptions that used to complete now fail.** A user whose preference is uninstalled has been getting silently-substituted transcripts; after this change they get an error. → The error names the exact model and carries a one-click download action. This is the intended behavior per the scope decision, and the substitution it replaces was unobservable — arguably worse.

**The `transcription_config` mirror can go stale.** A failed write, or a settings change made while the backend is unavailable, leaves background flows reading an old config. → Write on boot as well as on change, so a stale value self-heals on next launch. A missing or unparseable blob means "no configured model": the flow skips and logs, never substitutes.

**Existing queue entries from the current build.** Entries already persisted with `provider: "groq"` and `model_id: "groq-whisper"` will now fail fast with a clear message instead of the current "Transcription model not found". → Acceptable; they fail today too, just opaquely. The settings queue view already offers per-entry retry and "Clear Failed".

**Timestamp overlap at a checkpoint boundary.** Engine timestamps can round by a few milliseconds. → Resume from the greatest persisted `end_ms` and de-duplicate persisted segments by `(transcript_id, start_ms, end_ms, text)` so a boundary retry cannot duplicate visible text.

**Six locale files touched for copy that is mostly dynamic.** The engine phrase is interpolated, so translations of the surrounding sentence must accommodate a variable-position noun phrase. → Keep the interpolated segment to a bare `{provider} · {model}` fragment rather than a grammatically-embedded clause.

**Resolver drift risk if a new entry point is added.** Nothing structurally prevents a seventh call site from reading settings directly. → The two duplicated `MODEL_QUALITY_RANK` arrays get deleted as part of this change, so the resolver becomes the only place the ranking exists; a new call site has nothing to copy.

## Migration Plan

No schema migration. `app_settings` is an existing key/value table; `transcription_config` is created on the first settings write.

1. Ship the resolver and the label changes together — a label sourced from the resolver cannot be wrong about a route the resolver also chose.
2. Ship the frontend routing change (Groq work leaves the local queue) before or with the Rust provider check, so the check has nothing new to reject.
3. The mirror write ships before the background flows read it; a missing key is handled as "skip and log", so ordering is safe either way.

**Rollback:** the change is additive at the data layer (one new `app_settings` key, no schema change). Reverting the code leaves an orphaned key that is simply unread.

## Open Questions

- Should the settings "Transcribe All" action be disabled outright when the resolution is `ok: false`, or should it run and report per-item failures? Both satisfy the spec; the choice affects only the settings view's affordance and can be settled during implementation.
