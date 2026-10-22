## Context

See `proposal.md` for motivation and the two delta specs for observable behavior. Investigation found two independent causes:

- The local queue writes `transcripts` and `transcript_segments`, keyed by document/chapter, and then populates `documents.content` before marking completion (`src-tauri/src/transcription/auto_queue.rs:231,375–400`). Podcast imports retain the episode link as `metadata.source = podcast:<episode-id>` (`src-tauri/src/commands/podcast.rs:2475`).
- `get_podcast_transcript` reads only episode text and podcast segments and returns early when episode text is empty (`src-tauri/src/commands/podcast.rs:856–883`). `DocumentViewer.tsx:8480` restores the episode identity, so imported podcast documents enter this path too. `AudiobookViewer.tsx:2834` excludes podcasts from local queue recovery, and its podcast auto-start effect treats empty episode results as a reason to transcribe (`:3196`). A completed document transcript can therefore be invisible to the podcast viewer.
- Commit `cc843bf4` replaced Customize Session's `max-w-2xl w-full` container with `ResponsiveDialogSheet`, preserving mobile layering but losing the 42rem desktop maximum. The shared `dialogSurface` supplies utility-layer `w-full` (`src/components/md3/Dialog.tsx:20`), which overrides components-layer adaptive width rules (`src/index.css:656–684`). The current caller has no width override (`SessionCustomizeModal.tsx:360`).
- Existing viewer tests cover provider routing and chapter recovery. `src/visual/session-customize.visual.spec.ts:203` checks the desktop presentation class, not computed width. The Impeccable layout scan returned no findings; rendered geometry is necessary to catch this cascade defect.

The supplied screenshots are evidence of the symptoms, not instructions embedded in document content. The transcription diagnosis is source-supported; no user's production database was inspected.

## Goals / Non-Goals

**Goals:**

- Bridge existing transcript stores at their read boundary so old queue results work immediately and every caller sees consistent data.
- Keep durable transcript identity separate from disposable queue history and transient frontend state.
- Make absence explicit before allowing an automatic start, and retain existing provider routing once work is actually needed.
- Restore the session dialog's historical desktop geometry while preserving the mobile layering repair already in the tree.

**Non-Goals:**

- Replacing every transcript table or migrating the recording-session architecture.
- Changing speech recognition models, GPU behavior, provider selection, or charging policy.
- Redesigning session controls, tag selection, themes, or unrelated screenshot details such as cover artwork.

## Decisions

### 1. Resolve existing stores through a shared backend read boundary

Add repository-level resolution used by the podcast transcript command. Resolve episode-to-document links using the persisted `podcast:<episode-id>` metadata relationship; do not match by title or similar filenames. The backend must find the linked document even when the Podcasts player supplies a synthetic document identity. Ordinary media views continue to use their document/chapter transcript path.

Keep a usable completed episode transcript authoritative when present. When it is absent or unusable, resolve a completed document transcript using the queue's chapter identity when available and persisted transcript rows when queue history has been cleared. If multiple completed document rows exist, choose deterministically by completion/update recency with a stable tie-breaker; never merge chapters or unrelated revisions into one transcript. Keep partial rows distinct from complete results. A legacy episode text blob remains readable using the existing unsynchronized fallback.

Map document segments into the podcast response while preserving millisecond timestamps and optional word timing JSON; retain the frontend API's current conversion to seconds. Return saved data without running speech recognition, downloading audio, or requiring an installed transcription model. Resolution must also expose or allow lookup of active/missing/inconsistent state for the resolved item. Inspect existing API shapes during implementation and make only the minimal additive state change needed; an empty array alone cannot encode lookup failure.

**Alternatives considered:** Writing queue results only into podcast tables would help future jobs but strand old document-only transcripts. Mirroring all data into both stores introduces synchronization and overwrite hazards. A durable read-through bridge repairs the reported path and existing data without either requirement. A frontend-only fallback would leave other episode callers inconsistent.

### 2. Make viewer lookup and automatic start an ordered operation

Replace the loaded boolean's implicit success/failure conflation with explicit loading, ready, missing, active-job, and error outcomes for the current media identity. Resolve persisted sources and job state before consulting provider availability or starting work. Failed lookups and completed-without-data inconsistencies show retryable errors; they do not count as absence.

Observe queue updates for linked podcast documents as well as ordinary audio documents. On queue completion, re-read the resolved saved result. Register listeners and recheck state so completion during initial loading is not missed. Ignore responses belonging to an old document/episode after navigation; clear old progress and transcript state on identity changes.

Serialize automatic starts for each resolved media identity while the asynchronous start is pending, including panel reopen/remount. Reuse the existing job manager/backend uniqueness checks where possible; a component-local boolean alone does not cover remounts. Recheck active/completed state at the start boundary so queue completion racing a lookup cannot create redundant work. Once absence is confirmed, use the existing provider resolver and existing retry/manual-transcription affordances.

**Alternatives considered:** Disabling podcast auto-transcription globally would hide the symptom by removing expected behavior. Checking only the Completed queue badge fails after cleanup or restart. Neither satisfies saved-result reuse.

### 3. Keep successful completion behind durable persistence

Preserve the queue's current persistence-before-completion order, and verify that its transcript rows and full document text are readable before the completion event is published. Propagate persistence failures instead of publishing a successful job state. Reuse saved segment/word data; do not infer timings from document text or rerun the engine to populate another store. No destructive migration or startup-wide backfill is needed.

**Alternative considered:** Treating the badge as sufficient proof of content would leave a viewer with no readable result and recreate the failure under partial writes or old data.

### 4. Give adaptive surfaces explicit sizing ownership

Remove the competition between shared surface visuals and adaptive width rules, keeping non-adaptive dialogs' existing full-width behavior. Prefer an adaptive sizing class/variable or equivalent explicit size contract in the existing primitive; avoid global `!important` overrides. Apply the session-specific 42rem maximum on the centered desktop presentation. Other dialog callers keep their intended bounds; compact sheets retain their current responsive sizing.

Preserve title, grouping, spacing, and task order. Long tags wrap inside the bounded form; the body scrolls and header/footer remain visible. Keep the body portal, focus handling, overlay tokens, dynamic viewport bounds, safe-area padding, and compact footer arrangement introduced by `fix-session-customize-mobile-layering`. That change is already reflected in current source; reconcile its artifacts if implementation proceeds concurrently.

**Alternatives considered:** Reverting the adaptive migration would restore width while reintroducing mobile layering problems. Merely adding another `width` declaration in the weaker CSS layer can still lose to `w-full`. Capping every dialog at 42rem would change unrelated surfaces.

## Risks / Trade-offs

- **Ambiguous legacy links** → Require the persisted episode identity; never guess by title. Report missing/inconsistent data rather than showing another item's transcript.
- **Different timing units and word formats** → Test the backend-to-API conversion with saved timestamps and words, including text-only legacy data.
- **Several saved revisions or partial rows** → Keep complete-source precedence explicit and test deterministic selection; never replace a complete transcript with a partial result.
- **Lookup/event/start races** → Test delayed resolution, completion during loading, remounts, and navigation using provider-call assertions and backend active-job guards.
- **Shared width changes affect other dialogs** → Cover the adaptive primitive's default desktop and sheet sizing as well as Customize Session's own geometry.
- **Long forms on short windows** → Measure body scrolling and footer bounds using the real CSS at desktop, phone, tablet, and keyboard-reduced heights.

## Migration Plan

1. Add the read-through bridge and failing regression fixtures for existing document-only transcript data; retain the current tables and records.
2. Wire ordered viewer resolution and job observation, then restore desktop width through the adaptive size contract.
3. Run focused backend/frontend tests and the real browser geometry checks; run the required local performance gate for the implementation.
4. Verify a queue-completed episode opens from its document and Podcasts without a new provider call, including after restart and finished-row cleanup.

Rollback is a code rollback with no schema downgrade. Keep all saved transcripts intact. No baseline changes are planned; any intentional budget change must follow the repository's baseline-update policy.
