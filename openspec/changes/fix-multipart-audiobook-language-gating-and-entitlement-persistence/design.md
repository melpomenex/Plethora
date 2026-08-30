# Design: Multipart Audiobooks, Language Opt-In, and Entitlement Persistence

All paths relative to the repository root. Every decision below is grounded in the 2026-08-30 audit and was adversarially reviewed (data/sync/compat + QA) before implementation; review findings are folded in and marked *(review)*.

## Part A — Multipart audiobook imports

### Decision A1 — Canonical data model: Document + imported AudioEdition + ready sections

A multi-file audiobook is ONE `documents` row (fileType `audio`, title/author at book level, `file_path` = the first part's staged copy so legacy single-file behaviors keep working) + ONE `audio_editions` row (`provider = "imported"`, `status = "ready"`, `model`/`voice` = empty strings — the columns are NOT NULL but empty is legal — `total_duration_sec` = Σ section durations, `source_revision_hash` = the import fingerprint) + N `audio_edition_sections` rows (`generation_status = "ready"`, `audio_file_path` = staged copy, `duration_sec` = probed, `title` = derived, `section_index` = play order, `cache_key` = deterministic per part, `character_count` = 0 *(review: NOT NULL; legacy migration already writes 0)*, `audio_mime_type` derived per part from extension: mp3→`audio/mp3`, m4b/m4a→`audio/mp4`, ogg→`audio/ogg`, opus→`audio/opus`, flac→`audio/flac`, wav→`audio/wav`, aac→`audio/aac`, wma→`audio/x-ms-wma`).

The import fingerprint is stored in document metadata — which requires ADDING the field to both `DocumentMetadata` definitions *(review BLOCKER fix)*: `#[serde(default, rename = "importFingerprint")] pub import_fingerprint: Option<String>` in `src-tauri/src/models/document.rs` and `importFingerprint?: string` in `src/types/document.ts`. Without the declared fields, serde silently drops the value at the IPC boundary and at sync decode (`full_state.rs` re-serializes through the typed struct), killing both local and cross-device dedup.

Rationale for the model: the player already turns exactly this shape into a chaptered, resumable, global-timeline playlist (AudiobookViewer.tsx:913-989), delete already cascades via FKs. N hidden Documents — rejected (pollutes every library query/sync/search). New schema — rejected (existing model sufficient).

### Decision A2 — Grouping algorithm: directory-first, evidence-ranked, never "all audio anywhere = one book"

Planning happens in a new **pure** module `src/utils/audiobookImportPlanner.ts` over `StagedFile[]` (`{ path, relativePath, fileName }` — already returned by the folder plugin but discarded today), taking an options flag `rootIsPickedFolder` (true for folder imports; false for multi-file picks):

1. **Classify**: audio = extension ∈ `AUDIOBOOK_FORMATS`, compared **case-insensitively** *(review)*; everything else is an ordinary document.
2. **Group by directory**: audio files group by `dirname(relativePath)` (fallback `dirname(path)` when `relativePath` is absent). A group with ≥ 2 audio files is a candidate book; a singleton is a standalone import.
3. **Picked-root group** *(review: resolves the spec's headline scenario)*: when `rootIsPickedFolder` is true, files whose `relativePath` has no directory component (the picked folder itself) form ONE book titled by the picked folder's name (derived from the common path prefix; fallback "Audiobook"). This is required for `The Hobbit/01 - An Unexpected Party.mp3 …` — chapter titles share no filename base, so pattern evidence can never catch it; the user's folder pick IS the semantic signal. Accepted tradeoff (pinned in the spec with a scenario): picking a flat folder of unrelated audio (e.g. `Downloads/`) yields one book; user recourse is deleting/re-titling it or importing such files individually via the file picker.
4. **Merge volume subfolders** *(review: extended beyond disc/cd)*: sibling subdirectories whose own name matches `^(disc|disk|cd|part|pt|vol|volume|book|chapter|side)\s*(\d+)$` (case-insensitive, optional separator) merge into their parent directory's group; the parent name becomes the book title candidate. Files directly in the parent alongside such subfolders join that group. A parent whose audio lives entirely in mergeable subfolders is one book under the parent name (`Book/Part 1/*, Book/Part 2/*` → 1 book).
5. **Loose multi-file picks** (`rootIsPickedFolder` false, e.g. the audiobook dialog's multi-file select): ONE book only when every filename matches the same base under `detectMultiPartAudiobook`'s pattern set (natural-sorted); otherwise standalone. This preserves the dialog's existing multi-file-pick semantics.
6. **No cross-directory merging by similarity.** Directory boundaries are strong evidence: `Audiobooks/{BookA, BookB}` must yield two books even when both contain identically-named `01.mp3`.

Non-audio files inside book folders (e.g. `folder.txt` sidecars) flow through the ordinary per-file loop unchanged — today's folder-import behavior for non-audio files is preserved verbatim *(review: endorsed, spec-pinned)*. (Cover images like `folder.jpg` never reach the planner: the plugin's extension allowlist excludes images.)

Layered-evidence priority for *title/author* refinement (not grouping): explicit caller-provided overrides > consistent embedded album/album-artist tags (probed Rust-side) > `Author - Title` parse of the group's directory name. Grouping never requires metadata, so import works fully offline for untagged files.

### Decision A3 — Ordering: metadata > natural filename, never lexicographic

- The planner orders parts with a new `naturalCompare` (via `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })`; digit-aware comparator fallback).
- The Rust import re-sorts by `(disc_number, track_number)` when tags provide them for all parts (embedded track order must outrank misleading filenames). Ties/missing metadata fall back to the incoming natural order.
- `detectMultiPartAudiobook` switches its internal sort to `naturalCompare` (fixes `1, 10, 11, 2`).
- The fingerprint (A5) is computed over the **canonical final section order** (post re-sort) *(review: determinism)*.

### Decision A4 — Chapter titles: tags → cleaned filename → "Chapter N"

Per section: embedded track title → filename with extension and obvious numbering prefixes stripped (`^[\s\d]*[-–—:.]*\s*`, zero-padding, trailing part markers) → `Chapter N` (1-based). Book title/author never expose raw filenames. The command accepts optional `title`/`author`/`coverUrl`/`tags` overrides so `AudiobookImportDialog`'s user-edited metadata reaches the new path *(review)*; the dialog continues to persist its transcript record for multipart imports but WITHOUT the legacy `multiPart` key (so the edition playlist wins and the transcript remains usable).

### Decision A5 — Duplicate import identity (fingerprint)

`fingerprint = sha256(ordered ∑ sha256(partIdentity))` over the canonical final order, where `partIdentity` = `"{normalizedBasename}|{fileSizeBytes}|{durationSecRounded}"` with duration rounded to the **nearest second**; when duration probing fails for a part, the duration term is **omitted** (`"{basename}|{size}"`) so a partially-probed import still dedups against a fully-probed one *(review)*. `normalizedBasename` lowercases and strips non-alphanumerics (unicode-aware), so moved/renamed-staging copies and CJK names normalize consistently. Stored in BOTH `documents.metadata.importFingerprint` (syncs with the document row → cross-device dedup) and edition `generation_settings` (local fast path).

Dedup behavior *(review: cross-device fix)*: on fingerprint match the import returns the EXISTING document — and if that document lacks a local imported edition (the second-device/synced-row case, which has no sections or files because editions and audio never sync), the import SHALL create the edition/sections and stage the files onto that existing document rather than skipping. Dedup is about the logical document row, never about leaving an unplayable book. Concurrent identical imports are serialized by an in-process mutex keyed on fingerprint *(review)*. A differing fingerprint → new book (legitimate second copy).

### Decision A6 — Atomicity: stage first (collision-safe), single transaction, cleanup on failure

- **Staging** uses a collision-safe variant *(review BLOCKER-level fix)*: the existing `copy_media_to_app_storage` names destinations `{utc-seconds}-{basename}` — N parts staged in the same second with duplicate basenames (`Disc 1/01.mp3`, `Disc 2/01.mp3`) silently overwrite each other. The new shared helper (`pub(crate)`, extracted next to the original) stages each part as `{timestamp}-{short-uuid}-{sanitized-basename}`; file copies run via `spawn_blocking` so a multi-GB import cannot starve the async runtime *(review)*.
- **Transaction**: document creation and edition creation happen in ONE sqlx transaction. This requires extracting `create_document_tx(&mut Transaction)` from `Repository::create_document` — preserving `register_node_in_tx`, `journal_entity(EntityType::Document, Create, …)`, and post-commit notification so the new document still registers in the element tree and sync journal *(review)* — plus a `create_audio_edition_tx` variant of the existing edition insert (plain SQL over `&mut *tx`). The public `create_document` becomes a thin wrapper.
- **Cleanup**: on any error the staged copies created by this import are removed and nothing is persisted. Crash (not error) between staging and commit can leave orphan staged files — accepted limitation, documented *(review)*.

### Decision A7 — Staged-file lifetime: app-owned copies, not original paths

Desktop parts 2..N are copied into `{app_data_dir}/incrementum/audio/` exactly like part 1 today; mobile parts are already staged by the folder plugin into app-private storage and the Rust command copies from there. Section records NEVER point at user-picked originals (playback survives source-directory removal and restart). This replaces the legacy localStorage `multiPart.partFiles` design of original paths.

### Decision A8 — Audio Edition relationship and coexistence

- TTS-generated editions untouched. Transcript editions (`provider = "transcript"`) untouched; the player already prefers non-transcript ready editions.
- Legacy migration (`audioEditionMigration.ts`, provider `"legacy"`) unchanged; old `localStorage["audiobook-*"]` records keep working through the player's legacy read path (which correctly defers: the synchronous `multiPartInfo` load makes the async edition effect yield for legacy records).
- One imported edition per document: re-import of a different fingerprint onto a document that already has an imported edition is refused with a clear error.

### Decision A9 — Player consumption *(review: substantially reworked)*

The player's section playlist path already handles chapters/durations/position, but section sources are consumed as **raw** `audioFilePath` values by a synchronous `resolveSectionSourceAt` feeding `partSources`, `handleEnded`, and prefetch — while proper playback requires the async media-server/local-media resolution. Changes:

1. Section sources that are filesystem paths resolve asynchronously into `partSources` (extending the working-set effect; entries resolve on demand and prefetch across boundaries as today).
2. The single-file source-resolution effect (which resolves `document.filePath` and would shadow the playlist, and on desktop m4b needlessly runs the ffmpeg pre-transcode on part 1) is **gated off when a non-transcript ready edition owns the playlist**. The part-1 metadata-parse effect that repairs legacy localStorage records gets the same gate.
3. `goToPart`/`handleEnded` consume only resolved `partSources` entries.

### Decision A10 — Sync interaction

Documents sync as today (one row per book); `file_path` is stripped (http(s) passthrough preserved); `metadata` syncs via the whole-struct payload — which is exactly why `importFingerprint` must be a declared field on the Rust struct (A1). Audio binaries and edition/section rows do not sync (pre-existing, preserved). Second-device dedup attaches local media to the synced row (A5). No host absolute path is a cross-device identifier — the fingerprint is path-independent by construction.

### Decision A11 — Mixed/standalone/edge imports

- Mixed directories: non-audio files flow through the existing per-file loop unchanged (Kindle detection included).
- Standalone single audio file (incl. single m4b): never enters multipart logic (group requires ≥ 2 files; single-file dialog path unchanged).
- Unreadable/unsupported audio (e.g. WMA, which lofty cannot probe; corrupt files): probing degrades to duration-0, filename-derived title — **never fails the import** *(review)*. Duration-0 sections are tolerated by the cumulative chapter timeline and `total_duration_sec` (understated, not broken).
- Browser/PWA: folder picker is Tauri-only; `importMultipartAudiobook` throws a clear unsupported error in browser mode. Documented limitation.
- Deletion: document-delete cascade removes edition/sections/anchors/sessions; the edition-delete path additionally removes staged section audio files under app storage (filesystem paths only, never blob URLs), closing audit gap G9 for imported editions.

### Decision A12 — Metadata probing: lofty everywhere, degradation-first

`probe_audio_metadata` in `src-tauri/src/processor/audio.rs` (lofty — already a dependency, proven on Android): duration, title, artist, album, album-artist, track, disc. Any probe failure logs at warn and yields per-field `None` — import correctness never depends on probing, and ffmpeg is never required (G7).

## Part B — Language Learning opt-in

### Decision B1 — Master toggle: `languageLearning.enabled`, default OFF, v11 migration

`LanguageLearningSettings` becomes `{ enabled: boolean; suggestionsEnabled: boolean; showUnavailableProviders: boolean }` with defaults `{ false, true, true }`. Settings schema bumps 10 → 11 with an explicit `if (version < 11)` block forcing `enabled: false` (no persisted master-opt-in ever existed; `suggestionsEnabled: true` is a dead default, not a user choice). The field becomes non-optional on `Settings`. Verified safe: `migrate`'s `p.settings ?? p` root indirection mutates through to the persisted object, and `onRehydrateStorage`'s merge runs on post-migration state, so no path loses a v11 `enabled: true`.

The `languageLearning.enabled` key is added to `DEVICE_LOCAL_DENYLIST` *(review)*: the master opt-in is a per-device explicit choice, and denylisting prevents an older-version device's settings sync (whose `languageLearning` object lacks `enabled`) from unsetting it; the presentation sub-flags keep syncing. (Denylist matching is exact-or-prefix, so `languageLearning.enabled` denies only that key.)

### Decision B2 — Global dominance and mount-time gating (no CSS hiding, no hook-rule violations)

`effectiveLanguageModeEnabled = languageLearningEnabled && perDocumentLanguageModeEnabled`. When globally disabled, `DocumentViewerWrapper` renders the reader **without** the provider, banner, gate, panel, or overlays — the entire stack is unmounted, not hidden. React hooks (`useLanguageHostProductionBindings` etc.) remain called unconditionally per the rules of hooks *(review)*; only the rendered output is gated, and hook computations are cheap/memoized provider-object construction. Verified: every out-of-wrapper surface (`LanguageVideoHost`, `LanguageTranscriptDomBridge`, `SelectionActionsSheet`) self-nulls via `useOptionalLanguageLearningHost`, so provider-unmount gating removes them all including standalone `AudiobookViewer` mounts in podcast/EPUB-sync views.

### Decision B3 — Bypass surfaces and the per-document key *(review)*

- `DictionaryPeek` (mounted only under provider-gated hosts; its direct `activeProfileId` read is inert when unmounted) and `SelectionActionsSheet`'s learner-context injection remain covered by provider-unmount + defense-in-depth gating on the master flag where they read global state directly.
- `suggestionsEnabled` becomes the banner's gate (`enabled && suggestionsEnabled && perDocumentMode && evidence`) — its first real consumer.
- `showUnavailableProviders` remains a stored presentation preference (not removed — that would be a gratuitous settings break).
- **While globally disabled, the per-document key `plethora.language-mode.<id>` SHALL NOT be written** *(review: prevents the lazy-refactor bug where the effective value flows into the write effect and wipes stored preferences)*. The write effect persists the raw per-document state only, and only when the feature is globally enabled.

### Decision B4 — Settings UI

`LanguageLearningSettings.tsx` gains a master section: a switch with copy explicitly stating it controls whether language-learning tools appear in readers, with the suggestions toggle beneath. The Settings tab stays visible on desktop and mobile regardless of the flag (discoverability of an opt-in feature). The toggle persists immediately, applies reactively to open readers, and survives restart. Existing wrapper tests that assert language surfaces are updated to seed `languageLearning.enabled` *(review)*.

## Part C — Pro entitlement persistence

### Decision C1 — Authority model

Server `/v1/entitlements` (backed by `users.subscription_tier` + grants + quotas, reconciled by billing) remains the only authority that changes plan identity. The client's durable native cache stores the last server-verified snapshot per account; the frontend Zustand persist is a UI projection. Store receipts remain server inputs.

### Decision C2 — Wire format fix *(review BLOCKER fix — pre-existing bug)*

`EntitlementSnapshot` (and `QuotaState.resets_at`) in `src-tauri/src/entitlements/snapshot.rs` lack `#[serde(rename_all = "camelCase")]`, so IPC payloads carry `fetched_at`/`account_id` while `src/types/entitlements.ts` expects `fetchedAt`/`accountId` — today every native refresh yields `fetchedAt: undefined`, making `resolveCapability` compute `NaN` age and treat all server snapshots as past-grace. The change adds the serde attributes and a round-trip wire test; without it, every frontend mechanic below is built on unreadable fields.

### Decision C3 — Durable per-account native persistence

`settings` KV (`Repository.get_setting/set_setting`) stores under `plethora.entitlements`: `{"version":1,"accounts":{"<accountId>": <snapshot>}}`, camelCase wire format per C2. Account id comes from `AuthManager.get_user_id()`. Snapshots contain plan/capabilities/fetchedAt/source only — never tokens. The key joins `DEVICE_LOCAL_DENYLIST` (verified safe: `set_setting` takes the direct-write branch, merge/bootstrap skip it — identical to existing denylisted keys). Hydration (memory ← disk) happens lazily inside `entitlement_refresh`/`entitlement_get_snapshot` when memory is empty and an account is signed in — guaranteeing the persisted snapshot is in hand BEFORE any network attempt can fail. The map keeps the most recent snapshot per account.

### Decision C4 — Failure provenance: never stamp, never conflate defaults with verification

`entitlement_refresh` returns a typed outcome:

- `verified` — server 200 with a valid snapshot → set active in memory AND persist under the snapshot's `accountId`.
- `stale_cache` — signed in, fetch failed (network/5xx/timeout) → return `cache.resolve()` (hydrated persisted snapshot, TTL/grace applied on read) without writing anything. No `fetched_at` update.
- `auth_expired` — HTTP 401 with our bearer presented → nothing cached; frontend refreshes the token and retries once (C7).
- `anonymous` — no signed-in session → Free defaults, NOT cached, NOT persisted.

`fetch_entitlements` gains a structured error distinguishing `Unauthorized(401)` from transport failures. The old fallback block (`resolve() → fetched_at=now → set_cached_snapshot`) is deleted.

### Decision C5 — Grace semantics: identity ≠ capability availability

Past the 72-hour window, native `resolve()` keeps `plan` and `account_id` intact, marks `source = grace`, and degrades only non-free capabilities to `enabled: false, reason: offline` — the `snapshot.plan = free_defaults.plan` rewrite is deleted. Frontend `resolveCapability` already degrades capabilities without touching plan.

### Decision C6 — Server contract: presented-but-rejected bearer → 401

`optionalAuthMiddleware` (sole consumer: the entitlements route) captures the specific JWT error the way `authMiddleware` does and sets `req.authRejected = true` + `req.authError` (`token_expired` | `invalid_token`) before continuing — control flow unchanged. `/v1/entitlements` returns 401 with that code when the bearer was rejected; anonymous 200-Free only when no bearer was presented. No other callers exist (grep-verified across src, server, browser_extension).

### Decision C7 — Token lifecycle actually wired

- `accountStore.init()`: decode the access token's `exp` (base64 JWT payload inside try/catch — malformed tokens are treated as expiring *(review)*; no verification, expiry hint only); if expiring within 60 s and a refresh token exists, `await refresh()` BEFORE the first entitlement refresh.
- `accountStore.refresh()`: on success, re-mirror rotated tokens into native (`account_sync_session`) when signed in. On 401 from the refresh endpoint, sign out **only when the response parses as the Plethora API error shape** (`error.code`) — a captive portal or proxy answering a bare 401 HTML page is treated as a network failure and keeps the session *(review)*.
- `entitlementStore.refresh()` on `auth_expired`: call `accountStore.refresh()`, retry the native refresh exactly once; if still failing, keep the current snapshot and surface a non-blocking error state (never Free).

### Decision C8 — Race protection: generation + apply-time account checks on BOTH layers *(review: reworked)*

A monotonic generation counter in `entitlementStore.refresh()` discards stale responses, AND apply-time account validation: the frontend applies a snapshot only when its `accountId` matches the currently signed-in account (or both are absent). Natively, `entitlement_refresh`'s verified path compares `snapshot.account_id` with `auth.get_user_id()` before `set_cached_snapshot` (the in-memory cache is a single active slot): a response fetched for account A arriving after a switch to B (or sign-out) is still persisted under A's own disk key (harmless, useful) but NEVER becomes B's active snapshot. `account_sign_out` clears the in-memory snapshot. Tests cover mid-flight account switch and sign-out-during-inflight *(review)*.

### Decision C9 — Logout and account switching

`account_sign_out` clears native auth + the in-memory snapshot; `accountStore.signOut()` also resets the persisted frontend snapshot to `FREE_DEFAULT_SNAPSHOT`. Per-account disk snapshots remain keyed and inactive while logged out: logging back into A restores its last verified snapshot on the cold-start path; B never reads A's slot.

### Decision C10 — Legitimate downgrade still works

A `verified` Free response for the same account overwrites cached Pro everywhere (disk + memory + frontend). Cancellation/expiry via the authoritative endpoint is the only client-visible downgrade path besides logout/switching. "Once Pro, always Pro" is explicitly not implemented.

### Decision C11 — UI gating: central selectors, no flicker

`entitlementStore` exports `selectPlan`, `selectIsPro`, `selectEntitlementStatus`. Status derivation *(review)*: `checking` when the store's snapshot is `local_defaults` while an account is signed in (this also covers the one-time transition after upgrading from the buggy build, whose persisted snapshot may look Free-but-unverified — it must never read as confirmed Free), `verified`/`stale`/`anonymous` from snapshot source otherwise. `UserProfilePanel`, `SyncSettingsPanel`, and `UserMenu` consume the selectors; `UserMenu` stops displaying login-time `subscriptionTier` as the plan. `signIn`/`register` seed an optimistic snapshot from the auth response tier with `source: "cache"` (auth-verified, immediately corrected by the first refresh). Server `expiresAt` is advisory; client TTL derives from `fetchedAt` as today *(review)*.

### Decision C12 — Billing store relationship

Billing-provider selection/init performs no entitlement writes. Verified transactions trigger `entitlementStore.refresh()`, now safe under C4/C8.

### Decision C13 — Startup refresh in BOTH modes *(review: PWA fix)*

Today nothing refreshes entitlements in PWA at startup (`accountStore.init()` early-returns `!isTauri()`; `entitlementStore.init()` has no production callers), so a Pro PWA reload degrades capabilities while online. The startup bootstrap moves entitlement refresh out of the Tauri-only path: after account hydration, refresh runs in both modes — native outcome path on Tauri, the C14 server-fetch path in PWA. Startup registers the account bootstrap BEFORE billing init.

### Decision C14 — PWA parity (scoped)

In browser mode, `entitlementStore.refresh()` performs `GET /v1/entitlements` (bearer when authenticated; 401 → token refresh → retry; anonymous → server Free) with the same generation guard, replacing the old local `fetchedAt` re-stamp. Native persistence (C3) is Tauri-only; PWA keeps its localStorage projection.

## Backwards compatibility summary

- No database migrations; additive settings field + version bump; old audiobook localStorage records and legacy migration still function; existing TTS/transcript editions unaffected; standalone audio import unchanged; server change narrows only the presented-but-rejected-bearer case (previously a misleading Free 200).
- The entitlement wire-format fix (C2) changes the native IPC field names to what the frontend has always expected — old builds were already broken against these fields.
- Multi-account installs: entitlement slots keyed per account and device-local; `languageLearning.enabled` device-local; audiobook fingerprints are account-agnostic local-library data like their documents.

## Risks / trade-offs accepted

- Fingerprint uses size+duration+normalized-name, not content hashes (multi-GB hashing rejected for latency); re-rip with identical sizes/durations dedups — accepted.
- Picked flat folder of unrelated audio yields one book (A2.3) — accepted with user recourse; pattern evidence cannot identify chapter-named books.
- Crash (not error) between staging and commit can orphan staged files — accepted, documented.
- Last-known-Pro persists indefinitely while offline past grace: capabilities degrade, identity survives; downgrade applies on first successful server contact.
- `optionalAuthMiddleware` change is additive (flag + captured error code); sole consumer is the entitlements route.
