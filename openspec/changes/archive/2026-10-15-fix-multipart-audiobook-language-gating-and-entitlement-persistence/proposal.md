# Change: Fix Multipart Audiobook Imports, Language Learning Opt-In Gating, and Pro Entitlement Persistence

## Why

Three independent product-correctness defects share one theme: state that should be *semantic and durable* is currently *physical and ephemeral*.

1. **Multi-file audiobook imports explode into N library documents.** Picking a folder like `The Hobbit/01 - An Unexpected Party.mp3 … 33 - Return to Erebor.mp3` creates 33 separate library items. The dedicated `AudiobookImportDialog` has a half-implemented multipart path that imports only the *first* file, stores the remaining original (unstaged, desktop) paths in `localStorage["audiobook-{docId}"]`, writes fake chapters with `startTime: 0`, and never measures durations. The `Audio Edition` model (`audio_editions` / `audio_edition_sections`, migration 089) already supports exactly the right shape — one edition, N ready sections with per-section `audio_file_path`, `duration_sec`, `title`, `section_index` — and the player already consumes it (AudiobookViewer.tsx:913-989) — but **nothing in the import path ever creates an edition**.
2. **Language Learning UI is not opt-in.** `DocumentViewerWrapper` mounts the full `LanguageLearningHostProvider` stack (suggestion banner, association gate, `LanguageReaderHostPanel` bottom bar, four overlays) on **every** document. `LanguageLearningSettings` has only `suggestionsEnabled`/`showUnavailableProviders`, both of which are dead settings with zero consumers. There is no master toggle anywhere, and the reader bar renders regardless.
3. **Pro entitlements regress to Free on restart.** A verified Pro account that closes and reopens the app is sometimes shown as Free until logout/login. Audit confirmed three mechanisms: (a) access tokens are 15-minute JWTs, no production code ever refreshes them, and the server's `optionalAuthMiddleware` swallows `TokenExpiredError` so `/v1/entitlements` returns **HTTP 200 anonymous-Free** — the native side then caches that as a *server-verified fresh* snapshot and overwrites the persisted Pro snapshot; (b) the native `EntitlementCache` starts as `None` on every process and is **never persisted** (the `SETTINGS_KEY = "plethora.entitlements"` constant is unused), and `entitlement_refresh`'s fallback re-stamps Free defaults with `fetched_at = now`, making Free look fresh; (c) billing-init can trigger an entitlement refresh before the account session is mirrored into native auth, and `entitlementStore.refresh()` has no request-generation guard, so an older request can resolve last and win.

## Current State (Code-Grounded Audit, 2026-08-30)

### Audiobook import

- `documentStore.importFromFolder` → `pickFolderDocuments()` → `importFromFiles(paths)` → per-file `importDocument` loop (`src/stores/documentStore.ts:1024-1157`): one Document per audio file, no grouping. The folder plugin returns `relativePath` per staged file, which is discarded.
- `detectMultiPartAudiobook` (`src/api/audiobooks.ts:111-202`) exists and is wired only into `AudiobookImportDialog`; it uses plain lexicographic sort (so `10` sorts before `2`), has no directory awareness, no metadata evidence, and no tests.
- The multipart import path (`AudiobookImportDialog.tsx:641-685`) imports only `selectedFiles[0]`, writes `multiPart.partFiles` to localStorage, and its `updateDocumentApi` call silently drops `fileType`/`coverImageUrl`/`metadata` because `Repository::update_document` does not persist those columns (`repository.rs:1493-1521`).
- Audio dedup does not exist: `extract_content` returns empty text for audio → no `content_hash` → the duplicate check is skipped (`commands/document.rs:252-274`).
- No natural-sort utility exists anywhere (frontend or Rust).
- Mobile folder import already stages every picked file into app-private storage (`<filesDir>/imports/...`), so per-part paths are readable after the picker closes; desktop keeps original user paths until `import_document` copies media into `{app_data_dir}/audio/`.
- Audio Editions/sections never sync (`EntityType` has no audio-edition variants); audio binaries never sync. Documents sync with `file_path` stripped.

### Language learning

- Settings: `languageLearning?: { suggestionsEnabled: boolean; showUnavailableProviders: boolean }` at settings schema v10, defaults `true/true`, both fields dead (no consumers anywhere). Added without a version bump, so existing installs silently merged the defaults.
- Reader: `LanguageLearningHostProvider` wraps every `BaseDocumentViewer` unconditionally; `LanguageReaderHostPanel` (the always-visible "Language Mode" bar with its Enable button) is always mounted (`DocumentViewerWrapper.tsx:568-654`). Overlays null themselves when the host snapshot is not `ready`, and the per-document toggle (`plethora.language-mode.<documentId>`) only feeds `languageModeEnabled`, which the controller treats as `disabled` when off — but the *surfaces* still render.
- `DictionaryPeek` (selection flow) and `SelectionActionsSheet` bypass per-document mode by reading the global `activeProfileId` from `languageProfileStore` directly.
- Settings migration protocol: sequential `if (version < N)` blocks in `migrate()`; v2→v3 is the precedent for an intentional default-OFF flip.

### Entitlement

- Native `EntitlementCache` (`src-tauri/src/entitlements/mod.rs`): `cached_snapshot: RwLock<Option<EntitlementSnapshot>>`, starts `None`, never loaded from or written to disk. `SETTINGS_KEY` declared, unused.
- `entitlement_refresh` (mod.rs:262-289): on success caches + returns; on missing token or **any** fetch failure it takes `cache.resolve()` (which is `create_free_default_snapshot()` on an empty cache: `plan: "free"`, `fetched_at: 1970`), stamps `fetched_at = Utc::now()`, and caches it. Free defaults become indistinguishable from fresh server truth, then overwrite the frontend's persisted Pro snapshot via `entitlementStore.refresh()` (`entitlementStore.ts:133-155`, no generation guard).
- `resolve()` past the 72-hour grace rewrites `snapshot.plan = "free"` (mod.rs:97) — subscription identity is conflated with cloud capability availability.
- `fetch_entitlements` cannot distinguish 401 from other failures; the server cannot distinguish an expired bearer from anonymous (`optionalAuthMiddleware` catches all JWT errors; `server/src/routes/v1/entitlements.ts:34-51` returns 200-Free when `req.userId` is unset).
- `accountStore.refresh()` (the token refresher) has zero production callers, and even when called it does not re-mirror rotated tokens into the native `AuthManager`. `accountStore.init()` mirrors the possibly-expired persisted token and immediately refreshes entitlements with it.
- Startup: billing init registers before account init (`main.tsx:403-407` vs `410-423`); billing's verified-transaction handler can invoke an entitlement refresh at any time relative to session mirroring.
- UI reads `snapshot.plan === 'pro'` directly in `UserProfilePanel`, `SyncSettingsPanel`; `UserMenu` reads the login-time `user.subscriptionTier`. No central selectors exist. `entitlementStore.init()` and the `entitlement_get_snapshot` command are dead code.
- Server has zero test coverage for `/v1/entitlements` auth edge cases.

## What Changes

### Feature 1 — Multipart audiobook imports

- **Canonical representation**: ONE library Document (fileType `audio`) + ONE ready `AudioEdition` (provider `"imported"`, status `"ready"`) + N `audio_edition_sections` (one per physical file, `generation_status "ready"`, staged `audio_file_path`, probed `duration_sec`, derived title, deterministic `cache_key`). No schema changes — the migration-089 model is already sufficient.
- **Import planning stage** (new pure module `src/utils/audiobookImportPlanner.ts`): folder picker → classify candidates → group semantic units (directory-boundary + disc-folder merging + filename-pattern evidence for loose root files) → `ImportPlan { audiobooks, standalonePaths }`. Physical file count no longer equals document count.
- **Atomic Rust import** (new command `import_multipart_audiobook` in `src-tauri/src/commands/audiobook.rs`): probes tags/duration via lofty (cross-platform incl. Android; ffmpeg ffmetadata remains a desktop fallback), computes a deterministic import fingerprint, dedups against previously imported books, stages every part into app storage, then creates Document + Edition + N sections in one SQLite transaction. Failure removes staged files and leaves no partial book.
- **Ordering**: natural sort (`Intl.Collator` numeric) everywhere; embedded track/disc numbers outrank filenames when present.
- **Chapter titles**: embedded tag title → cleaned filename (numbering prefix stripped) → `Chapter N`.
- **Dedup**: fingerprint = ordered set of per-part identities (file size + duration + normalized basename); stored in document metadata (`importFingerprint`) and edition `generation_settings`; re-import returns the existing document instead of duplicating.
- **Player**: section sources that are filesystem paths resolve through the existing media-server/local-media resolution instead of being handed raw paths.

### Feature 2 — Language Learning opt-in

- New master flag `languageLearning.enabled` (default `false`), settings v10 → v11 migration that sets `enabled: false` for all existing installs (no persisted master state exists to preserve; `suggestionsEnabled: true` is NOT treated as opt-in).
- `effectiveLanguageModeEnabled = globalEnabled && perDocumentEnabled`. Global OFF mounts **no** language provider, panel, banner, gate, overlays, or selection-flow learner context — the reader behaves as if the feature does not exist. Per-document preferences persist untouched for later re-enable.
- `suggestionsEnabled` finally gets a consumer: the suggestion banner renders only when master + per-document mode + suggestions are all on.
- Settings UI gains a master toggle with explicit copy; the tab stays visible for discoverability on desktop and mobile.

### Feature 3 — Pro entitlement persistence

- **Durable, account-scoped native cache**: server-verified snapshots persist to the SQLite `settings` KV under `plethora.entitlements` as `{ accounts: { <accountId>: snapshot } }`, keyed by the native-auth-known account id. The key is added to `DEVICE_LOCAL_DENYLIST` so snapshots never ride the settings sync.
- **No failure stamping**: failed/unauthenticated refreshes never write `fetched_at`, never cache Free defaults, and never overwrite a persisted verified snapshot. `entitlement_refresh` returns a typed outcome (`verified` | `stale_cache` | `auth_expired` | `anonymous`) instead of a bare snapshot.
- **Server contract fix**: `/v1/entitlements` returns **401** when a bearer token was presented but rejected (expired/invalid), and 200-Free only for genuinely anonymous requests. `optionalAuthMiddleware` records `authRejected` without changing behavior for its other consumers.
- **Token refresh actually wired**: `accountStore.init()` refreshes an expired/near-expiry access token before the first entitlement fetch; `accountStore.refresh()` re-mirrors rotated tokens into native auth; `entitlementStore.refresh()` handles `auth_expired` by refreshing the token and retrying once; `signOut()` on refresh-token rejection is retained (legitimate session revocation).
- **Race protection**: monotonic refresh generation in `entitlementStore.refresh()`; stale responses are discarded. Startup registers account init before billing init.
- **Grace semantics**: past the 72-hour offline window the plan identity is preserved; only cloud capabilities degrade (`reason: offline`, `source: grace`). Native `resolve()` no longer rewrites `plan` to `free`.
- **Logout/account switching**: `account_sign_out` clears the in-memory snapshot; logged-out state resolves anonymous Free defaults while per-account persisted snapshots remain on disk for future logins of that account. No cross-account leakage.
- **Central selectors** (`selectPlan`, `selectIsPro`, `selectEntitlementStatus`) in `entitlementStore`, consumed by `UserProfilePanel`, `SyncSettingsPanel`, and `UserMenu`. Login/register seed an optimistic auth-verified plan (source `cache`) so the UI never flashes "Upgrade" between login and the first entitlement refresh.

## Capabilities

### New Capabilities
- `multipart-audiobook-import`: Semantic folder-import planning, atomic one-document-per-book persistence, ordering/title derivation, dedup identity, and player consumption of multi-file audiobooks.
- `language-learning-opt-in`: Global master opt-in for Language Learning surfaces, default OFF, migration semantics, global-over-local dominance, and settings UI.
- `entitlement-persistence`: Durable account-scoped verified-entitlement caching, failure provenance, token-refresh integration, race protection, logout/account-switch isolation, and server 401 contract.

### Modified Capabilities
<!-- No existing openspec/specs/ capabilities are altered; the three areas above have no prior source-level capability specs. -->

## Impact

- **Frontend**: `src/utils/audiobookImportPlanner.ts` (new), `src/api/audiobooks.ts` (natural sort + planner API), `src/api/documents.ts` (multipart import client), `src/types/document.ts` (`importFingerprint` metadata field), `src/stores/documentStore.ts` (planner wiring in `importFromFolder`/`importFromFiles`), `src/components/import/AudiobookImportDialog.tsx` (multipart path rewritten onto the new command), `src/components/viewer/AudiobookViewer.tsx` (section source resolution + edition-owned-playlist gating), `src/stores/settingsStore.ts` (v11 + `enabled`), `src/components/settings/LanguageLearningSettings.tsx` (master toggle), `src/components/viewer/DocumentViewerWrapper.tsx` (gating), selection-flow gating, `src/stores/entitlementStore.ts` (outcome handling, generation + account guards, selectors, PWA server fetch), `src/stores/accountStore.ts` (expiry-aware init, native re-mirror on refresh), `src/main.tsx` (init ordering, dual-mode entitlement bootstrap), `src/components/settings/UserProfilePanel.tsx`, `src/components/settings/SyncSettingsPanel.tsx`, `src/components/auth/UserMenu.tsx` (selectors).
- **Rust**: `src-tauri/src/commands/audiobook.rs` (`import_multipart_audiobook` + lofty probe helpers), `src-tauri/src/processor/audio.rs` (tag/duration extraction), `src-tauri/src/models/document.rs` (`import_fingerprint` metadata field), `src-tauri/src/database/repository.rs` (`create_document_tx` extraction) + `audio_edition_repository.rs` (`create_audio_edition_tx`), `src-tauri/src/entitlements/mod.rs` (durable per-account cache, outcome enum, no-stamp failure path, grace fix, apply-time account guard, sign-out clearing) + `snapshot.rs` (camelCase wire format), `src-tauri/src/plethora_auth/mod.rs` (`account_sign_out` cache clearing), `src-tauri/src/sync/settings.rs` (denylist entries), `src-tauri/src/lib.rs` (command registration).
- **Server**: `server/src/middleware/auth.ts` (`authRejected` flag), `server/src/routes/v1/entitlements.ts` (401 on rejected bearer).
- **Data/migrations**: none (no schema changes; durable entitlements use the existing `settings` KV table).
- **Privacy**: no new external calls at import time (offline import works; remote cover/enrichment stays best-effort and unchanged). Entitlement persistence stores plan/capabilities only — no tokens — in the existing local SQLite settings store.

## Definition of Done

This change is complete only when **all** hold:

1. Importing a directory representing one audiobook creates exactly one logical audiobook whose tracks appear as ordered chapters; N physical files ≠ N documents.
2. Multiple audiobook groups in one selected root are separated; mixed content (PDF/EPUB/Markdown + book folders) still imports correctly; standalone audio files are unaffected.
3. Import is atomic (no orphan documents/editions/sections/staged files on failure) and idempotent (re-import dedups by fingerprint).
4. The audiobook player treats sections as one continuous book: chapter navigation across files, total duration, resume across restart.
5. Language Learning is OFF by default; existing installs migrate OFF; reader language UI is entirely absent (not mounted, not hidden) while disabled; global OFF overrides per-document ON; the setting persists across restart and applies immediately when toggled while a reader is open.
6. A verified Pro account remains Pro through app restart (online and offline), through entitlement-request failures and 5xx, and through expired access tokens when the refresh token is valid.
7. The native entitlement cache survives process recreation; Free defaults can never overwrite a persisted verified Pro snapshot; failed refreshes never refresh timestamps.
8. An authoritative server Free response still downgrades Pro → Free; logout and account switching never leak prior account state; the 72-hour offline window degrades cloud capabilities without flipping plan identity.
9. Concurrent refresh races are covered by generation-guard tests; the UI never advertises "Upgrade" to a known Pro account during normal hydration.
10. All new suites pass together with typecheck, lint, the existing vitest run, `cargo test`, and `openspec validate --strict` for this change.
