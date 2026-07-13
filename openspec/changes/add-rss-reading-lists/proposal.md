## Why

The RSS Scroll Mode is an immersive, TikTok-style article reader, but it always loads **every subscribed feed** — launching it from a folder or category context loses that context. Users have no way to say "scroll only my Tech folder right now," no way to pull together an ad-hoc mix of feeds for a particular reading session, and no way to save a curated selection to reuse later (e.g. "Morning Coffee," "Weekend Long-Reads"). The grouping scaffolding already exists (folders + category sections in the sidebar), but it doesn't extend into scroll mode, and there's no persisted, reusable selection concept.

## What Changes

- **Folder/category → Scroll Mode.** Section headers (folder dividers and category dividers) in the RSS sidebar become clickable entry points that open Scroll Mode scoped to just the feeds in that section. Also adds a per-section "Scroll" affordance.
- **Ad-hoc feed selection.** A sidebar "select" mode lets the user multi-select any combination of feeds and folders, then "Scroll selected" to enter Scroll Mode with exactly that mix — no saving required.
- **Reading Lists (new persisted concept).** Users can save any selection (a folder, a category, or an ad-hoc set of feeds) as a named **Reading List** via a dialog. Reading Lists are reusable, editable, deletable, and launchable into Scroll Mode (or the standard article list) in one click.
- **Reading List management UI.** A "Reading Lists" panel/section surfaces saved lists with launch, edit, duplicate, and delete actions, plus unread counts.
- **Backend persistence.** Reading Lists are stored in a new `rss_reading_lists` table (Tauri + HTTP backend), mirroring the existing `rss_folders` pattern, so they survive reinstall and are sync-capable — not localStorage.
- **Scroll Mode filtering plumbing.** `RSSScrollMode` gains a feed-scope prop (folder id, category, explicit feed ids, or a reading-list id) so it loads only the selected feeds instead of unconditionally calling `getSubscribedFeedsAuto()`.
- **i18n.** Full translations for all new labels/strings across all six locales (en, es, de, fr, ja, zh).

## Capabilities

### New Capabilities
- `rss-reading-lists`: Creation, editing, deletion, persistence, and one-click launch of saved feed selections ("Reading Lists") into the RSS article list and Scroll Mode, including ad-hoc (unsaved) feed selection and folder/category-scoped scroll entry.

### Modified Capabilities
- `rss-import-navigation`: Extends folder/category navigation so selecting a section header can open Scroll Mode scoped to that section's feeds (in addition to the existing "show combined article list" behavior).

## Impact

- **Backend (Rust + HTTP):** new `rss_reading_lists` table + CRUD commands/endpoints; a feed-scoped article/feed fetch path (or reuse of `getRiverOfNewsAuto`/`getSubscribedFeedsAuto` with a feed-id filter). New Tauri commands registered in `invoke_handler`.
- **Frontend API layer:** new `src/api/rss-reading-lists.ts` (types + `*Auto` helpers) paralleling `rss-folders.ts`.
- **`RSSReader.tsx`:** section headers gain a "scroll this section" action; new select mode (multi-select feeds/folders); "Scroll selected" button; Reading Lists panel + create/edit dialog wiring; pass scope into `RSSScrollMode`.
- **`RSSScrollMode.tsx`:** extend props (`folderId?`, `category?`, `feedIds?`, `readingListId?`); refactor `loadFeeds` to honor scope instead of always loading all subscribed feeds; header reflects active scope name.
- **i18n:** new keys in all six locale files under `en.ts`/`es.ts`/`de.ts`/`fr.ts`/`ja.ts`/`zh.ts`.
- **Out of scope (explicit):** cross-device sync transport, OPML import of reading lists, sharing reading lists between users, server-side recommendation of reading lists.
