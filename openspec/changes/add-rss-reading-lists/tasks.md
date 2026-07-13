## 1. Backend: Reading Lists data model & storage

- [x] 1.1 Add `rss_reading_lists` table migration (idempotent `CREATE TABLE IF NOT EXISTS`) next to the `rss_folders` migration: columns `id TEXT PK`, `name TEXT NOT NULL`, `feed_ids TEXT NOT NULL` (JSON array), `icon TEXT`, `sort_order INTEGER NOT NULL DEFAULT 0`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.
- [x] 1.2 Add Rust model/struct (`ReadingList`) + serde serialization matching the TS `ReadingList` type.
- [x] 1.3 Implement CRUD commands: `get_reading_lists`, `create_reading_list`, `update_reading_list`, `delete_reading_list`, `duplicate_reading_list`.
- [x] 1.4 Register the new commands in the Tauri `invoke_handler` alongside the folder commands.

## 2. Backend: HTTP endpoints

- [x] 2.1 Add HTTP routes under `/api/rss/reading-lists`: `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/duplicate`, mirroring the command args/returns.
- [x] 2.2 Ensure JSON wire format matches the Tauri command returns exactly (snake_case → camelCase boundary consistent with `rss-folders.ts`).

## 3. Frontend API layer

- [x] 3.1 Create `src/api/rss-reading-lists.ts` with `ReadingList` type and `*Auto` helpers (`getReadingListsAuto`, `createReadingListAuto`, `updateReadingListAuto`, `deleteReadingListAuto`, `duplicateReadingListAuto`) following the `shouldUseHttp()` + `invokeCommand` pattern from `rss-folders.ts`.
- [x] 3.2 Add a `ScrollFeedScope` discriminated-union type (kinds: `all`, `folder`, `category`, `feeds`, `readingList`; each non-`all` carrying a `label`) in `src/api/rss.ts` or a new `src/api/rss-scroll-scope.ts`.

## 4. Scroll Mode: scope plumbing

- [x] 4.1 Extend `RSSScrollModeProps` with an optional `scope?: ScrollFeedScope` (default `{ kind: "all" }`).
- [x] 4.2 Refactor `loadFeeds` (RSSScrollMode.tsx ~347-389) to resolve the scope to a concrete `Feed[]`: `all` → all subscribed (current behavior); `folder`/`category` → filter `getSubscribedFeedsAuto()` by the section's feed ids (reuse the `groupedFeeds` membership logic); `feeds` → filter by explicit ids; `readingList` → fetch list via `getReadingListsAuto()` and filter. De-duplicate by feed id; drop stale (unsubscribed) ids silently.
- [x] 4.3 Show `scope.label` in the Scroll Mode header next to the position counter (only when scope ≠ `all`).
- [x] 4.4 Preserve existing behavior: interleave, engagement sort, mark-as-read/favorite/summary/extract flows unchanged on the scoped set; verify the empty-state path for a scope with zero feeds.
- [x] 4.5 Add scope param to the launch site in `RSSReader.tsx` (lines ~1438-1440) so callers can pass a scope.

## 5. Sidebar: section-level scroll entry

- [x] 5.1 Add a "scroll this section" icon button to each folder/category section divider render (RSSReader.tsx ~1869-1925), keyboard-focusable and aria-labeled.
- [x] 5.2 Wire its click to set `scrollMode = true` with a `folder` or `category` scope (label = section name) and leave the existing header-click → article-list behavior untouched.
- [x] 5.3 Handle the empty-section case: opening scroll on a section with no active feeds lands in the Scroll Mode empty state without errors.

## 6. Sidebar: ad-hoc select mode

- [x] 6.1 Add a "Select" toggle to the sidebar header; track `selectMode: boolean` and `selectedFeedIds: Set<string>` state.
- [x] 6.2 In select mode, render a checkbox on each feed row and each folder row; checking a folder adds all its current feed ids to `selectedFeedIds`.
- [x] 6.3 Add a sticky action bar (visible only in select mode) with: feed count, "Scroll selected (N)", "Save as Reading List…", and "Cancel".
- [x] 6.4 "Scroll selected" opens Scroll Mode with a `feeds` scope (label = `${N} feeds`), de-duplicated; disabled when selection empty.
- [x] 6.5 "Cancel"/exiting select mode clears `selectedFeedIds` and restores normal navigation.

## 7. Reading List dialog & management panel

- [x] 7.1 Build `CreateEditReadingListDialog` (`src/components/media/readingLists/CreateEditReadingListDialog.tsx`): name field (required, disables Save when empty), icon picker, checkbox tree of feeds/folders; supports create and edit modes; accepts an optional pre-fill (`{ name, feedIds }`) for "save current section".
- [x] 7.2 Wire "Save as Reading List…" from the select-mode action bar to open the dialog pre-filled with `selectedFeedIds`.
- [x] 7.3 Add a per-section "Save as Reading List" action that pre-fills the dialog with the section's feed ids and a default name derived from the section name.
- [x] 7.4 Build `ReadingListPanel` (`src/components/media/readingLists/ReadingListPanel.tsx`): lists saved Reading Lists with name, icon, unread count; row actions Launch (scroll), Launch (list), Edit, Duplicate, Delete; empty state with explanation.
- [x] 7.5 Mount `ReadingListPanel` as a new section in the RSS sidebar (default position: above Folders).
- [x] 7.6 Implement Launch(scroll) → Scroll Mode with `readingList` scope; Launch(list) → set `selectedFolderId`-equivalent to the list's feed set and show combined article list.
- [x] 7.7 Implement unread-count aggregation client-side from loaded feeds; recompute when feeds/reading lists change.

## 8. i18n

- [x] 8.1 Add all `rss.readingLists.*` keys to `en.ts` (titles, buttons, dialog fields, empty states, tooltips, aria labels, scope header label templates).
- [x] 8.2 Translate the new keys to `es.ts`, `de.ts`, `fr.ts`, `ja.ts`, `zh.ts`.
- [x] 8.3 Verify no raw fallback keys appear in the UI across all six locales.

## 9. Verification

- [ ] 9.1 Manual: create, edit, duplicate, delete a Reading List; verify persistence across app restart.
- [ ] 9.2 Manual: scroll a folder section, a category section, an ad-hoc selection, and a saved Reading List; confirm the queue contains only scoped feeds and the header shows the correct label.
- [ ] 9.3 Manual: confirm mark-as-read, favorite, summary, and extract flows still work inside a scoped session.
- [ ] 9.4 Manual: verify the stale-feed-id path (unsubscribe a feed that's in a list; relaunch → no error, ghost feed absent).
- [x] 9.5 Typecheck/lint: `npm run build` (or project equivalent) passes with no new errors.
