## Context

The RSS reader (`src/components/media/RSSReader.tsx`) already groups feeds into sidebar sections via the `groupedFeeds` memo (lines ~168-209). Sections are produced in priority order: **folders** (from `getFeedFolders()`, stored in localStorage) → **category** fallback (from `feed.category`) → **ungrouped**. Each section renders a header followed by its feed rows.

Scroll Mode (`src/components/media/RSSScrollMode.tsx`) is the immersive TikTok-style reader. It is launched from `RSSReader` by setting `scrollMode = true` and rendering `<RSSScrollMode onExit={...} initialFeedId={selectedFeed?.id} />` (lines ~1438-1440). Crucially, `RSSScrollMode.loadFeeds` (lines ~347-389) **always** calls `getSubscribedFeedsAuto()` and loads every subscribed feed; `initialFeedId` only reorders. There is **no** way to scope it to a subset of feeds, and there is **no** persisted "saved selection" concept anywhere in the RSS surface (the `SavedView` pattern exists only for Documents; `Collections` is for learning items).

The backend already has a folder system with two coexisting implementations:
- **Legacy localStorage folders** (`rss.ts` `FeedFolder`, `getFeedFolders`) — what `RSSReader` currently renders.
- **Backend `rss_folders` table** (`rss-folders.ts` `RssFolder`, `getFoldersAuto`) — richer (parent_id, sort_order, auto_mark_after_days); used by `SemanticGraphPanel` and migrated into on first run.

Reading Lists will follow the **backend-table** pattern (Tauri + HTTP), per the agreed decision, because it survives reinstall, is sync-capable, and matches the direction the codebase is already moving (folders are migrating off localStorage).

## Goals / Non-Goals

**Goals:**
- Let users enter Scroll Mode scoped to a single folder section, a single category section, or any ad-hoc set of feeds — in one click from the sidebar.
- Let users save a reusable, named **Reading List** (a set of feed ids, optionally derived from a folder/category) and launch it into Scroll Mode or the article list.
- Persist Reading Lists in a backend table identical in shape to the existing folder storage, with full CRUD via Tauri commands and HTTP endpoints.
- Keep Scroll Mode's existing behavior (interleaving, engagement sort, mark-as-read, favorites, summaries, extracts) fully intact when scoped.
- Make the scope visible inside Scroll Mode (header shows "Morning Coffee" / "Tech" / "3 feeds").

**Non-Goals:**
- Cross-device sync transport (persistence only; sync wiring is a future change).
- Importing/exporting Reading Lists via OPML.
- Server-side recommendation or auto-generation of Reading Lists.
- A dedicated full-screen Reading Lists browser — lists surface in the existing sidebar/panel.
- Changing the legacy-vs-backend folder split; this change does not consolidate them.

## Decisions

### Decision 1: Reading Lists are a new `rss_reading_lists` backend table, not a folder overload
Each Reading List is a flat row: `{ id, name, feed_ids: string[], icon?, sort_order, created_at, updated_at }`. Feed ids reference whatever feeds the user currently has, regardless of which folder they live in.

**Why not overload folders?** Folders are containers feeds *live in* (a feed is in one folder). A Reading List is a *query/selection* — the same feed can be in many lists, and lists exist purely to drive a reading session. Conflating them would force a feed into one folder and break the "curate a mix" use case. A separate table keeps both concepts honest.

**Why a table, not localStorage?** User decision + matches the `rss_folders` backend pattern + survives reinstall + sync-ready.

**Alternative considered:** storing lists as a JSON blob in a settings KV. Rejected — we need per-list CRUD, unread-count aggregation, and ordering, all of which a dedicated table serves far better, consistent with how folders already work.

### Decision 2: A single "feed scope" discriminated input to `RSSScrollMode`
Extend `RSSScrollModeProps` with one optional scope object rather than several booleans:

```ts
type ScrollFeedScope =
  | { kind: "all" }
  | { kind: "folder"; folderId: string; label: string }
  | { kind: "category"; category: string; label: string }
  | { kind: "feeds"; feedIds: string[]; label: string }
  | { kind: "readingList"; readingListId: string; label: string };
```

`RSSScrollMode.loadFeeds` resolves the scope to a concrete `Feed[]` once, then runs the existing interleave + engagement-sort + render pipeline unchanged. `label` is shown in the Scroll Mode header.

**Why discriminated union over separate props?** Prevents impossible states (e.g. `folderId` + `category` both set), makes the header label authoritative from the call site, and keeps `initialFeedId` orthogonal (it still just reorders within the scoped set).

**Alternative considered:** pass a pre-resolved `Feed[]` directly. Rejected — `RSSScrollMode` currently owns fetch + unread state, and passing feeds in would split the data lifecycle and break the mark-as-read-on-scroll flow that mutates `scrollItems` derived from the loaded feeds.

### Decision 3: Scope resolution reuses existing fetch, filters client-side
`getSubscribedFeedsAuto()` already returns all subscribed feeds with their items. For folder/category/feeds/reading-list scopes we fetch all and filter by id/category client-side (folder→feedIds via the same `groupedFeeds` logic; reading-list→`feed_ids` from the backend row). No new backend feed-fetch endpoint is required for v1.

**Why not add a backend `get_feeds_for_scope` command now?** YAGNI — the client already has the data, and filtering is O(feeds). A backend path can be added later for sync/large libraries without changing the prop contract. (The existing `getRiverOfNewsAuto(folderId)` returns flat articles, not `Feed[]` with items, so it doesn't fit Scroll Mode's per-feed rendering.)

**Trade-off:** on very large libraries this loads more than needed. Acceptable for v1; flagged in Risks.

### Decision 4: Two complementary entry flows (sidebar multi-select + Reading List dialog)
- **Section headers (folders + categories)** get a dedicated "Scroll this section" affordance (an icon button on the divider) in addition to the existing click-to-view-articles behavior. One click → Scroll Mode scoped to that section.
- **Select mode toggle** in the sidebar header: when on, each feed/folder row shows a checkbox; a sticky action bar offers "Scroll selected (N)" and "Save as Reading List…". This is the ad-hoc path.
- **Reading List dialog** (`CreateEditReadingListDialog`): name + checkbox tree of feeds/folders + icon picker. Used both to *create* and to *edit* saved lists. Saving from the multi-select action bar opens this dialog pre-filled with the selection.
- **Reading Lists panel** (new section in the sidebar, above or below folders): lists saved Reading Lists with unread counts; each row has Launch (scroll), Launch (list), Edit, Duplicate, Delete.

**Why both flows?** User decision — multi-select for speed/serendipity, dialog for curation/persistence. They share the same dialog component so there's one editing UX.

### Decision 5: Naming = "Reading Lists"
i18n key root: `rss.readingLists.*` (e.g. `rss.readingLists.title`, `rss.readingLists.scrollSelected`, `rss.readingLists.empty`). Type/component names: `ReadingList`, `rss-reading-lists.ts`, `ReadingListPanel`, `CreateEditReadingListDialog`. Distinct from "Folders" which remain feed containers.

## Risks / Trade-offs

- **[Risk] Duplicate feed across a folder and a reading list double-counts in scroll.** → Mitigation: scope resolution de-duplicates by feed id before interleaving; Scroll Mode header shows the unique feed count.
- **[Risk] Legacy localStorage folders vs backend folders means a "folder" scope's feed set depends on which system the folder lives in.** → Mitigation: scope resolution goes through the *same* `groupedFeeds` source `RSSReader` already uses, so whatever the user currently sees in a section is exactly what scrolls — no divergence.
- **[Risk] Client-side filtering loads all feeds every time Scroll Mode opens.** → Mitigation: acceptable for v1; the existing unscoped path already does this. Add a backend `get_feeds_for_scope` later only if profiling shows a problem.
- **[Risk] Sidebar multi-select mode adds UI complexity / accidental toggles.** → Mitigation: select mode is an explicit toggle with a clear exit; selection is discarded on exit (unless saved); the action bar is sticky and always visible while in select mode.
- **[Trade-off] Reading Lists don't auto-update when a feed is deleted or a folder's membership changes.** → Mitigation: scope resolution filters to currently-subscribed feeds, so a stale feed id in a list is silently ignored (no crash, no ghost entries). A future enhancement can prune on read.
- **[Risk] Backend schema migration must run on existing installs.** → Mitigation: idempotent `CREATE TABLE IF NOT EXISTS` in the existing migration path; no data to backfill (new feature); rollback is `DROP TABLE rss_reading_lists`.

## Migration Plan

1. Add `rss_reading_lists` table via an idempotent migration in the existing DB setup (same location as `rss_folders` creation).
2. Register new Tauri commands in `invoke_handler` alongside the folder commands.
3. Add HTTP endpoints under `/api/rss/reading-lists` mirroring the folder endpoints (GET, POST, PUT/:id, DELETE/:id, POST /:id/launch-articles optional).
4. Ship frontend behind the existing feature surface — no feature flag needed; Reading Lists panel is additive.
5. **Rollback:** revert frontend + drop the table. No user data loss since lists are new.

## Open Questions

- Should the Reading Lists panel sit *above* or *below* the Folders section in the sidebar? (Default: above, since launching a reading session is the higher-frequency action. Confirmable during implementation.)
- Unread-count aggregation for Reading Lists: compute client-side from loaded feeds (cheap, v1) vs. a backend count query (accurate, later)? Default: client-side for v1.
