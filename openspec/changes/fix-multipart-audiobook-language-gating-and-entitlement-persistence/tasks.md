# Tasks

## 1. Shared utilities & data model (Feature 1 foundation)

- [ ] 1.1 Add `naturalCompare` (Intl.Collator numeric, digit-aware fallback) as a reusable util with unit tests; switch `detectMultiPartAudiobook`'s internal sort to it
- [ ] 1.2 Create pure planner module `src/utils/audiobookImportPlanner.ts`: classify (case-insensitive extensions) → group by directory → picked-root rule (`rootIsPickedFolder`) → merge volume-keyword subfolders (`disc|disk|cd|part|pt|vol|volume|book|chapter|side` + number) → loose-pick pattern grouping → `ImportPlan { audiobooks: { title, author?, files }[], standalonePaths }`; unit tests for every grouping case in the spec matrix incl. picked-root, junk flat folder, `Part 1`/`Part 2` merge, disc variants, `.MP3`, unicode
- [ ] 1.3 Extend `src-tauri/src/processor/audio.rs` with `probe_audio_metadata` (lofty): duration, title, artist, album, album_artist, track, disc — every field degrades to `None` on probe failure (WMA, corrupt); unit tests
- [ ] 1.4 Add `import_fingerprint` to `DocumentMetadata` (Rust, `#[serde(default)]` camelCase rename) and `importFingerprint?` to `src/types/document.ts`
- [ ] 1.5 Add `import_multipart_audiobook` Rust command: probe → fingerprint (canonical order, duration omitted on probe failure, nearest-second rounding) → dedup (in-process per-fingerprint mutex; attach media to existing document when it lacks a local imported edition) → collision-safe `spawn_blocking` staging (`{ts}-{short-uuid}-{name}`) → single-tx document+edition+sections via new `create_document_tx` (preserving element-tree registration + sync journaling + notifications) and `create_audio_edition_tx` → cleanup on failure; accepts `title`/`author`/`coverUrl`/`tags` overrides
- [ ] 1.6 Expose `importMultipartAudiobook` in the frontend API client with typed result (`document`, `deduplicated`, `attachedToExisting`)

## 2. Import pipeline wiring (Feature 1)

- [ ] 2.1 `documentStore.importFromFolder`: keep full `StagedFile[]`, run the planner with `rootIsPickedFolder: true`, import book groups via the new command, feed the remainder to the existing loop; progress/toast accounting counts logical items
- [ ] 2.2 `documentStore.importFromFiles`: after Kindle detection, run planner partitioning (`rootIsPickedFolder: false`, filename evidence) so multi-file audiobook picks produce one book
- [ ] 2.3 Rewrite `AudiobookImportDialog`'s multipart path onto the new command with user-edited title/author/cover/tags overrides; transcript record persists WITHOUT the legacy `multiPart` key; keep single-file and batch flows
- [ ] 2.4 `AudiobookViewer`: async-resolve filesystem-path section sources into `partSources` (working-set aware); gate the single-file source-resolution effect (incl. desktop m4b ffmpeg pre-transcode) and the part-1 metadata-parse effect when a non-transcript ready edition owns the playlist; `goToPart`/`handleEnded` consume resolved entries
- [ ] 2.5 Register the new command in `lib.rs`; staged-section audio cleanup on edition delete

## 3. Language Learning opt-in (Feature 2)

- [ ] 3.1 `settingsStore`: add `enabled` (default `false`), non-optional field, schema v11 with explicit `< 11` migration forcing `enabled: false`; add `languageLearning.enabled` to `DEVICE_LOCAL_DENYLIST`
- [ ] 3.2 `DocumentViewerWrapper`: `effectiveLanguageModeEnabled` gating — provider/panel/banner/gate/overlays unmounted when disabled; hooks stay unconditional; per-document key NOT written while globally disabled (raw pref only, and only when enabled)
- [ ] 3.3 Gate the suggestion banner on `enabled && suggestionsEnabled && perDocumentMode && evidence`
- [ ] 3.4 `LanguageLearningSettings.tsx`: master toggle with explicit copy + wired suggestions toggle; verify mobile + desktop
- [ ] 3.5 Tests: defaults → no language bar; global OFF + per-doc ON → nothing rendered AND stored key untouched; re-enable restores tools without re-configuration; global ON → opt-in surface; global ON + per-doc ON → full tools; toggle OFF while reader open disappears immediately; restart persistence; v10→v11 migration → OFF; update existing wrapper tests to seed `languageLearning.enabled`

## 4. Entitlement native persistence (Feature 3, Rust)

- [ ] 4.1 Add `#[serde(rename_all = "camelCase")]` to `EntitlementSnapshot` + audit `QuotaState`/`QuotaWindow` field names; wire round-trip test (Rust ↔ TS field names)
- [ ] 4.2 `EntitlementCache`: durable load/persist of per-account snapshots via `Repository.get_setting/set_setting` under `plethora.entitlements`; lazy hydration for the signed-in account; add key to `DEVICE_LOCAL_DENYLIST`
- [ ] 4.3 `fetch_entitlements`: structured error distinguishing 401 `Unauthorized` from transport failures
- [ ] 4.4 `entitlement_refresh`: typed outcome enum (`verified`/`stale_cache`/`auth_expired`/`anonymous`); delete the Free-stamping fallback; persist only on `verified` (under the snapshot's own accountId); apply-time account guard before `set_cached_snapshot`; hydrate before fetch
- [ ] 4.5 `resolve()`: past-grace keeps `plan`/`account_id`, degrades only non-free capabilities; update affected unit test
- [ ] 4.6 `account_sign_out` clears the in-memory snapshot; `entitlement_get_snapshot` hydrates from disk
- [ ] 4.7 Rust tests: wire-format round trip; persist/load through process recreation; per-account isolation; failure never updates `fetched_at` nor caches defaults; 401 → `auth_expired`; anonymous never persisted; grace keeps plan; sign-out yields anonymous Free; late response for account A never becomes B's active snapshot (mid-flight switch + sign-out during inflight)

## 5. Entitlement frontend & server (Feature 3, TS + server)

- [ ] 5.1 Server: `optionalAuthMiddleware` captures the JWT error kind and sets `authRejected`/`authError`; `/v1/entitlements` returns 401 (`token_expired`/`invalid_token`) for presented-but-rejected bearers; anonymous 200 only without bearer; server tests pinning all three cases + middleware unchanged control flow
- [ ] 5.2 `accountStore.init()`: refresh expired/near-expiry access tokens (crash-safe `exp` decode) before the first entitlement refresh; `accountStore.refresh()` re-mirrors rotated tokens to native; sign-out on 401 only when the response parses as the API error shape
- [ ] 5.3 `entitlementStore.refresh()`: outcome handling (`auth_expired` → token refresh → one retry), monotonic generation guard + apply-time account check, PWA server-fetch parity (bearer/401/anonymous), `signOut` resets the persisted snapshot to Free defaults
- [ ] 5.4 `signIn`/`register` seed an auth-verified optimistic snapshot (`source: "cache"`)
- [ ] 5.5 Add `selectPlan`/`selectIsPro`/`selectEntitlementStatus` (`local_defaults` + signed-in → `checking`, never confirmed Free); convert `UserProfilePanel`, `SyncSettingsPanel`, `UserMenu`
- [ ] 5.6 `main.tsx`: register account bootstrap (entitlement refresh in BOTH Tauri and PWA modes after account hydration) before billing init
- [ ] 5.7 Frontend tests: cold-restart online/offline Pro retention; combined offline + expired-token startup; expired-token refresh-and-retry; 5xx keeps Pro; authoritative Free downgrades; logout anonymous; account switch both directions; concurrent refresh generation guard; mid-flight account switch; failed refresh leaves `fetchedAt` untouched; malformed JWT exp; PWA reload refreshes from server

## 6. Validation

- [ ] 6.1 `npx tsc` (typecheck) clean
- [ ] 6.2 `npm run test:run` (full vitest) green, including all new suites
- [ ] 6.3 `cd src-tauri && cargo test` green
- [ ] 6.4 `npm run lint` clean
- [ ] 6.5 `npm run bench:check` (per AGENTS.md gate; update `scripts/perf-baselines.json` in-change if the player source-resolution change is an intentional perf change)
- [ ] 6.6 `openspec validate fix-multipart-audiobook-language-gating-and-entitlement-persistence --type change --strict` passes
- [ ] 6.7 Post-implementation adversarial review findings resolved
