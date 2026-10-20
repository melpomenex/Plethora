## Context

See `proposal.md` for the problem and scope. The attached reference's concept 5 supplies the disclosure idea; its tiny controls and screenshot text are not production requirements. Preserve Plethora's incumbent visual system, as documented in `DESIGN.md` and `docs/design-system.md`.

### Verified implementation, 2026-10-20

Inspected working tree based on `e5e52634`, including existing uncommitted changes. Line numbers below are investigation anchors; locate the named blocks again if the working tree moves.

| Source | Finding and implementation consequence |
| --- | --- |
| `src/components/media/RSSReader.tsx:325,2671,2777` | `articleLayout` is a separate local `list / magazine / grid` selector. List, or any selected desktop article, gives the middle pane `lg:w-[420px]`; it is still flex-shrinkable. Keep its nominal width and pane composition. Add `min-w-0` to the existing list/preview flex children to prevent intrinsic-content overflow; do not widen the application or change the sidebar/reader arrangement. |
| `RSSReader.tsx:2847–2915` | Only List uses `rssListParentRef`, an absolute-positioned spacer, and measured row wrappers. The row has status, image, `flex-1 min-w-0` text, and six controls as sibling flex items. Default `view_mode=card` adds `flex-wrap`; other values do not. Toolbar opacity hides it on desktop without freeing its width. Replace this inner layout, retaining the list boundary and callbacks. |
| `RSSReader.tsx:1780` | `useVirtualizer` has `count: items.length`, `estimateSize: () => 96`, `overscan: 10`, and no `getItemKey`. React keys already use feed/item IDs, but virtualizer size-cache keys currently use indexes. |
| `RSSReader.tsx:631,1787` | Two selection-driven scroll effects exist: DOM `scrollIntoView({behavior:'smooth'})` and virtualizer `scrollToIndex(...,{align:'auto'})`. They are not disclosure effects. Consolidate List selection scrolling onto the virtualizer and disable smooth scrolling there; keep the existing DOM path for Magazine/Grid. |
| `RSSReader.tsx:990` | `handleItemClick` selects item/feed, marks read locally and asynchronously, tracks the unread session, and navigates mobile to the reader. Reuse unchanged. Existing unread retention/filtering must remain intact. |
| `RSSReader.tsx:2900` | Actions, in order: fetch if `!item.fullContent`; favorite always; external link always; unread if `item.read`; intelligence always; tag always. All stop click propagation; external also prevents default. Tag deliberately sets selected item/feed and opens the tag input. |
| `RSSReader.tsx:1841,2908` | Existing intelligence button only opens/positions `TrainingMenu`; that menu receives the *currently selected* item/feed. It does not retarget selection to the clicked row. Preserve this existing behavior and document the limitation, rather than silently changing training semantics. |
| `src/components/media/ArticleLayouts.tsx:26` | Magazine/Grid share `ArticleCards` and are not virtualized. Leave this file unchanged. Their existing layout/selection/context-menu tests remain regression coverage. |
| `src/types/rssCustomization.ts:63,119,141` | Defaults, enum/range normalization, and `resolveRssPreferences` already exist. `view_mode=card/list/compact` is independent of `articleLayout`; use resolved preferences without new fields. Excerpt length is 50–500 characters, default 150; thumbnail size is small/large; card height is compact/normal/tall. |
| `src/components/media/RSSCustomizationPanel.tsx:294` | Existing controls already cover the needed choices. No new expansion setting, preference migration, or panel rewrite. |
| `src/api/rss.ts:152,1039,2584` | Reuse `getFeedIcon`, `formatFeedDate`, and `generateArticleExcerpt`. Excerpt extraction parses HTML using `DOMParser`, so memoize it per mounted card and content/length change, not per pointer movement or whole-feed iteration. |
| `src/components/media/KeyboardShortcutProvider.tsx:80` | Shortcuts listen on document **capture**, so a descendant bubble `stopPropagation()` cannot protect a native control from a remapped Enter/Space/Escape shortcut. Add the narrow guard described below. |
| `src/styles/reading.css:157`; `src/index.css:152,182` | RSS layout styles already live in `reading.css`. Motion uses `--md-duration-short` (150ms) and `--md-easing-standard`; reduced motion and application animation settings set duration to zero. The stylesheet is already imported. |
| Installed `@tanstack/virtual-core` 3.13.18, `src/index.ts:243,380,862,887` | `measureElement` registers a border-box `ResizeObserver`, reads `borderBoxSize` or `offsetHeight`, and calls `resizeItem` when size changes. Default correction also adjusts partially visible rows. `shouldAdjustScrollPositionOnItemSizeChange` is an **instance property**, not a constructor option in this installed version. The React adapter rerenders on size notifications. |

`src/visual/rss-customization.visual.spec.ts`, `src/visual/rssCustomizationHarness.tsx`, and `public/rss-customization-harness.html` already exercise the real `RSSReader` through mocked HTTP routes. Vitest uses jsdom and Testing Library (`vitest.config.ts`); real geometry belongs in Playwright (`playwright.config.ts`). Do not use the separate, currently untracked RSS selection harness as this feature's foundation.

The existing `article-layouts` spec describes a separate left/top thumbnail-position choice, but the verified preference type and customization panel contain no position field/control. Its delta replaces that stale scenario with actual presentation/size-driven placement. Do not add a position preference or redesign Magazine/Grid to satisfy the stale wording.

## Goals / Non-Goals

**Goals:** Readable collapsed headlines at actual pane widths of 320–420px; all controls present; equivalent pointer, keyboard, and touch disclosure; bounded work per mounted row; stable variable-height virtualization; precise preference semantics.

**Non-goals:** New persisted state; changing article filtering/ranking, unread retention, training targets, reader text selection, or reader rendering; new animation/test frameworks; changing Magazine/Grid or scroll mode. Do not touch Rust or build native installers. Preserve the pre-existing edits in this worktree.

### Exact implementation file manifest

These are expected future implementation edits, not changes made by this planning task. Paths are relative to the repository root `/home/ubuntu/Code/Plethora`.

| File | Operation |
| --- | --- |
| `src/components/media/RSSListArticleCard.tsx` | New: isolated measured List card and interaction state. |
| `src/components/media/RSSReader.tsx` | Edit List mapping/action slot, virtualizer identity/anchor policy, and List selection-scroll guards; retain the reader. |
| `src/styles/reading.css` | Append only scoped List styles. |
| `src/components/media/KeyboardShortcutProvider.tsx` | Edit native-control key guard only. |
| `src/lib/i18n/locales/en.ts` | Append eight accessibility/detail strings. |
| `src/components/media/__tests__/rssListArticleCard.test.tsx` | New: card behavior and measurement integration unit tests. |
| `src/components/media/__tests__/rssKeyboardShortcutProvider.test.tsx` | New: native activation/capture guard tests. |
| `src/visual/rssCustomizationHarness.tsx` | Extend fixture modes, theme providers, and controls. |
| `src/visual/rss-customization.visual.spec.ts` | Extend the harness interface declaration while retaining existing tests. |
| `src/visual/rss-list-disclosure.visual.spec.ts` | New: real browser geometry, interactions, and stress coverage. |

No edit is required to `public/rss-customization-harness.html`, `ArticleLayouts.tsx`, `RSSCustomizationPanel.tsx`, `rssCustomization.ts`, reader/full-content/story components, shared menu infrastructure, or package files.

## Decisions

### 1. One local component, existing action handlers

Create `src/components/media/RSSListArticleCard.tsx`, owning the existing measured row wrapper and its article presentation/interaction state. Replace only the map's returned List row with this component. Keep filtering, `items`, action semantics, and the virtualizer in `RSSReader`.

Proposed interface (new names below are intentional; imported types/utilities above already exist):

```tsx
interface RSSListArticleCardProps {
  feed: Feed;
  item: FeedItem;
  preferences: RssUserPreferenceUpdate | null;
  selected: boolean;
  index: number;
  start: number;
  isScrolling: boolean;
  measureElement: (node: HTMLDivElement | null) => void;
  actions: React.ReactNode;
  onSelect: (feed: Feed, item: FeedItem) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onMenuKeyDown: (event: React.KeyboardEvent) => void;
}
```

The component's root retains `data-index`, the measurement ref, and `position:absolute; top:0; left:0; width:100%; transform:translateY(start)`. The inner article retains `data-article-id` and adds `data-rss-list-card` plus `data-expanded="true" / "false"` for scoped styles and the keyboard guard. Root has no vertical margins; padding and borders belong inside the measured box. Memoize normalized preferences and the plain-text excerpt. Use `React.memo` with normal prop comparison, no comparator that ignores callbacks. Actions supplied as a slot can rerender on parent updates; memoization is an optimization, not a correctness assumption. Do not centralize hover state in `RSSReader` or a store. TanStack may still rerender the mounted range to update positions; it must never mount all 1,000 items.

Keep the six original controls as a JSX fragment in `RSSReader`, passed through `actions`. Convert their size/state styling locally, keeping each handler body, icon, order, condition, title, external-link `href`, and propagation guards. Reuse `iconButtonVariants({size:'md'})` from `src/components/md3/IconButton.tsx` for the buttons and anchor, with an RSS-specific control class and existing Phosphor glyphs. Do not replace the external anchor with a button. Add `type="button"`, accessible labels equal to tooltips, and `aria-pressed` for favorite; preserve all icon state changes.

The child renders a permanent details toggle after the six-action fragment, using existing `CaretDown` / `CaretUp` Phosphor icons. Its localized labels are “Show article details” / “Hide article details”, `aria-expanded` reflects effective disclosure, and `aria-controls` points to the detail region from `useId()`. Keep it separate from the six article commands in semantics; it never invokes `onSelect`. No overflow menu or hidden controls.

### 2. Header has independent title and action regions

Make `.rss-list-viewport` on the existing list scroll element an inline-size query container (`container-type:inline-size; container-name:rss-list`), `min-width:0`, `overflow-y:auto`, and `overflow-anchor:none`. Named container queries are based on actual List width, never screen width. Without container-query support, the stacked default remains usable.

```text
List width < 720px (including the usual 420px desktop pane)
┌─────────────────────────────────────────────────────┐
│ Headline: full inner width, up to 2 / 4 lines        │
│              [fetch][★][↗][unread][train][tag][⌄]   │ header
├─────────────────────────────────────────────────────┤
│ [optional thumbnail]  ● intelligence Source · time  │ body
│                       [optional full-content badge] │
│                       [expanded excerpt]            │
│                       [expanded author]             │
└─────────────────────────────────────────────────────┘
List width >= 720px
│ Headline: >=240px           [all eligible actions][⌄]│ header
│ [thumbnail] ● intelligence Source · time             │ body
│             [expanded excerpt / author]              │
```

Use a `<header className="rss-list-header">` grid with title and action group as siblings. Base CSS: `display:grid; grid-template-columns:minmax(0,1fr); gap:4px`. Title is in an `h3`; its native button has `width:100%; min-width:0; text-align:start; white-space:normal; overflow-wrap:anywhere`. It inherits `text-sm` (14px), line height 20px, semibold. Collapsed title clamps to two lines, expanded to four; do not use `break-all`. Full title text remains in the accessible name and `title` attribute. No fixed title width, and no thumbnail/status/toolbar sibling inside its grid cell.

`.rss-list-actions`: a `role="group"` with the localized article-actions name, `display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; min-width:0; width:100%`. Each direct control: `width:40px; height:40px; flex:0 0 40px`, 16px icon, no shrinking or opacity hiding. At `@media(pointer:coarse)` use actual `48px` dimensions/flex basis; this avoids overlapping hit-slop. Seven controls need 304px on fine pointers or 360px on coarse pointers; wrap into multiple rows below those inner widths. Keep ordering and trailing alignment. Never horizontal-scroll the toolbar or truncate the title to fit it.

At `@container rss-list (min-width:720px)`, set the header to `grid-template-columns:minmax(240px,1fr) max-content; column-gap:12px; align-items:start`; action width becomes `auto` and wrapping becomes `nowrap`. Even the 360px coarse toolbar plus title, gap, comfortable padding, border, and a conventional scrollbar fits at 720px. Do not lower this threshold based on which conditional actions happen to be present; that would make the header jump between topologies on read/fetch changes.

At 420px pane width with normal density, headline width is the full inner width: about 369–386px depending on scrollbar, rather than whatever remains after four flex siblings. Acceptance minimum is 340px for all densities at 420px, and 240px at 320px, with every action eligible. If the application physically gives less than 320px, keep the stacked layout and toolbar wrapping; do not enforce a 240px min-width that causes overflow. At zoomed or enlarged text sizes wrapping/clamping still works; four visible expanded lines are a deliberate bound, with the full title in the reader and accessible name.

Body uses grid `auto minmax(0,1fr)` with an 8px column gap when there is a thumbnail; otherwise a single `minmax(0,1fr)` column. The thumbnail is **below the header**, left of source/preview information. Status indicators move into the source row before the feed name, consuming no headline width. Source name may ellipsize; optional date is a nonshrinking `<time dateTime={item.pubDate}>` using `formatFeedDate`. Additional metadata wraps inside the body, never forces header width. Omit invalid dates instead of rendering an invalid timestamp. Preserve the existing fetched-content glyph/badge using theme-primary styling.

Selected articles retain the 2px leading primary border and muted selection background; reserve a transparent 2px leading border for unselected rows so widths match. Hover/disclosure uses a subtle muted background. Keyboard focus adds an inset 2px primary outline to the article and a visible focus ring on the actual control; keep the selected border visible. Read headlines use muted foreground, unread headlines foreground, with the status dot using `bg-muted` for read and `bg-primary` for unread plus localized screen-reader status. Wrap the existing `IntelligenceIndicator` in an accessible status label (neutral/positive/negative and score); do not modify that shared component or encode meaning only in color. Favorite retains its star/pressed state. Use `bg-card`, `border-border/60`, `text-foreground`, `text-muted-foreground`, and primary tokens; no hardcoded yellow, new gradients, lifts, or shadows.

### 3. Preference contract is explicit

Resolve once with `resolveRssPreferences(preferences ?? {})`. The outer `articleLayout` gates the feature; `view_mode` only changes the List's presentation. Keep the panel and preference types unchanged.

| Preference | Collapsed | Expanded |
| --- | --- | --- |
| `density=compact` | padding `8px 12px`; header/body gap 4px | same outer padding, detail stack gap 4px |
| `density=normal` | padding `12px 16px`; header/body gap 6px | same outer padding, detail stack gap 6px |
| `density=comfortable` | padding `16px 20px`; header/body gap 8px | same outer padding, detail stack gap 8px |
| `view_mode=card` | small thumbnail 96×64; large thumbnail full body width ×160px above source row, always below header | same thumbnail geometry |
| `view_mode=list` | small thumbnail 64×48; large 96×64, left of body | same thumbnail geometry |
| `view_mode=compact` | no thumbnail or excerpt; retain source, status, optional date, title, actions | no thumbnail; excerpt maximum two lines unless card height is compact |
| `show_thumbnails=false` or no image | no thumbnail container/placeholder/gap | same |
| `thumbnail_size` | mappings above; use `item.thumbnail` then image enclosure, matching current source choice | never resize on disclosure |
| `card_height=compact` | no excerpt | no excerpt; reveal longer title and author only |
| `card_height=normal` | no excerpt | maximum three excerpt lines (two in compact view mode) |
| `card_height=tall` | no excerpt | maximum four excerpt lines (two in compact view mode) |
| `excerpt_length` | no excerpt | apply existing character cap, then line clamp; short text need not fill the allotted lines |
| `show_author=true` and author exists | author deferred | `by {author}`, wrapping with `overflow-wrap:anywhere`; false hides it in both states |
| `show_date` | optional relative date | same; false never reveals it |
| `show_feed_icon` | optional existing favicon beside source | same; false never reveals it |

The collapsed List intentionally defers excerpts even for tall cards; tall sets the *expanded* preview budget. This is the scoped semantic change needed for progressive disclosure. Card height remains content-driven, not a fixed pixel height; it must never clip the action group. Compact height is an intentional excerpt opt-out, not an ignored preference. Missing descriptions produce no empty paragraph, reserved height, or loading request. Source for an allowed excerpt is `fullContent || description || content || ''`; use `generateArticleExcerpt` once in a `useMemo` keyed by those strings and length. Do not inject feed HTML. Broken thumbnails hide the image region locally on `onError`, resetting the failure flag when URL changes; the resulting row change is measured. Large images use a fixed reserved 160px box and object-fit cover. Small images also reserve their dimensions before loading.

No additional metadata fetches or per-row tag-store queries. Do not add category/tag chips merely because other concepts in the reference show them.

### 4. Card-local disclosure state and intentional input

State is ephemeral per mounted feed/item row, never persisted and never keyed to `selected`. Keep booleans for `hoverActive`, `keyboardWithin`, `pinned`, `dismissed`, and a dwell timer ref. Effective state is `expanded = !dismissed && (hoverActive || keyboardWithin || pinned)`.

| Input | Result |
| --- | --- |
| Real mouse movement within a card, `(hover:hover) and (pointer:fine)`, list not scrolling | Arm a single 120ms dwell timer if not active/pending. On expiry, if still inside and mounted, enable hover. Pointer-enter alone records presence; it does not arm, avoiding expansions caused solely by rows moving under a stationary cursor. Repeated movement does not restart the timer or set state. |
| Pointer leaves / pointer cancel | Cancel dwell and clear hover immediately. Retain only keyboard or explicit-toggle reasons. |
| Keyboard focus enters any title/action/details control | Expand immediately when target matches `:focus-visible`; retain while focus moves between descendants. `onKeyDownCapture` for Tab within the card also establishes keyboard intent. Do not make the article wrapper a second focus stop. |
| Pointer-down within card | Clear the keyboard-intent flag; ordinary mouse/touch focus must not pin the preview after pointer leave. Do not prevent native focus or activation. |
| Blur to an element outside the article (including `relatedTarget=null`) | Clear keyboard intent, pinned state, and dismissal; collapse unless genuinely still hovered. Movement between descendants does not collapse. |
| Details toggle while collapsed | Clear dismissal, set `pinned=true`. Pointer/touch expands without selecting, marking read, or navigating. |
| Details toggle while expanded | Set `pinned=false`, clear hover/timer, and set `dismissed=true` so the still-focused toggle does not immediately reopen it. The same toggle can reopen immediately on its next activation. |
| Escape while expanded and focus is in the card | Dismiss as above, prevent default and stop propagation; preserve focus. Do not change selection/read state. If a menu/dialog owns focus outside the card, that overlay owns Escape. |
| Leaving the pointer-and-focus interaction, or a new keyboard focus entry from outside | Clear dismissal. Hover can rearm only on subsequent real pointer movement. |
| Selection changes | No disclosure transition. A keyboard-selected article may remain expanded while it actually retains keyboard focus; selecting via a pointer must not become a persistent reason. |
| `isScrolling=true` | Cancel dwell and hover. Keep explicit keyboard/toggle disclosure while its row remains mounted. Do not rearm automatically when scrolling stops; require a new mouse movement. |
| Scope change, row unmount, article replacement | Clear timer and all local state; no stale preview for a recycled row. |

Read state and favorites remain data-driven. Hover/focus/toggle must not call `handleItemClick`, change favorites, fetch content, or mark anything read. Touch uses the same permanent details control; tapping title/body still opens on the first tap using existing mobile navigation. No long press or double tap. Touch details remain open until toggle, outside blur, unmount, or scope change; this deliberate state is the exception to temporary hover/focus collapse. Multiple deliberately opened mounted cards are allowed; there is no global expansion registry.

Use `onBlurCapture` containment checks. Native title button gets the default Enter/Space behavior and stops its click from bubbling before calling `onSelect`; the article background click calls `onSelect` only when the target is not inside a button/anchor/input/select/textarea or other interactive descendant. Do not place buttons inside a button or give the entire article `role="button"`. Title then six eligible actions then details is the DOM/Tab order. Keep action nodes mounted, in the same order/location, throughout disclosure; the header does not move beneath the pointer when excerpt/title height changes except for actual extra title lines.

Bind `onMenuKeyDown` on the native title/details controls and `articleMenuKeyDown(feed,item,e)` on each of the six parent-supplied controls for Shift+F10/ContextMenu. Do not also call it from a bubbling article handler: `useSurfaceMenu.handleRowKeyDown` records `e.currentTarget` for focus restoration, which must be the actual focusable control rather than the article wrapper. Its handled events already stop propagation. The article's own key handler handles disclosure Escape. Do not add custom arrow-key navigation: existing j/k and arrow shortcuts continue selecting through `handleKeyboardAction`. They may scroll selection into view but do not manufacture focus or disclosure. In `KeyboardShortcutProvider`, before shortcut matching, return for **unmodified** Enter/Space/Spacebar when target is inside `[data-rss-list-card]` and closest `button` or `a[href]`; also return for unmodified Escape inside an **expanded** marked card (`data-expanded="true"`) so local dismissal runs first. A collapsed card does not claim Escape. Preserve modified shortcuts such as Shift+Enter and every shortcut elsewhere. Use `target.closest`, since the event target can be an icon descendant. This guard is necessary because the existing provider runs in capture phase. Add a component-level test using a remapped Space command to prove native activation is not stolen.

Use localized English keys in `src/lib/i18n/locales/en.ts`: `rssReader.showArticleDetails`, `rssReader.hideArticleDetails`, `rssReader.articleActions`, `rssReader.readArticleStatus`, `rssReader.unreadArticleStatus`, `rssReader.intelligenceNeutral`, `rssReader.intelligencePositive`, `rssReader.intelligenceNegative`. Include a `{score}` placeholder for nonneutral intelligence. Existing action labels remain identical. Existing locale fallback in `src/lib/i18n/index.ts:160` supports these without speculative translations. No live region announcing every pointer transition. Always mount the detail-region element with its stable ID and `hidden={!expanded}` so `aria-controls` resolves even while collapsed; explicitly style `.rss-list-details[hidden] { display:none }` so a grid display rule cannot override the hidden state. It contains no focusable controls.

### 5. Preserve command behavior exactly

| Action | Condition / existing callback | Contract |
| --- | --- | --- |
| Download | `!item.fullContent`; `fetchArticleFullContent(item.id,item.link)` | Stop propagation; same “Fetch full content” title. Does not select. Fetched data may hide this action; layout remeasures. |
| Favorite | always; `handleToggleFavorite(feed,item)` | Stop propagation; same translated add/remove tooltip; star and pressed state update. Does not select through bubbling. |
| External | always; `<a href={item.link}>`, `handleOpenOriginal(item.link)` | Both prevent default and stop propagation, retaining existing in-app/external opening policy. |
| Unread | `item.read`; `handleMarkUnread(feed,item)` | Stop propagation; same “Mark as unread” title. Do not introduce an inline mark-read replacement. |
| Intelligence | always; `setShowTrainingMenu(true)` and existing client-coordinate position | Stop propagation and preserve current selected-item training semantics. No new targeting or selection. |
| Tag | always; set selected item/feed and `setShowTagInput(true)` | Stop propagation; same “Tag article” title. This is an intentional selection side effect, **without** invoking `handleItemClick` or marking read. Preserve it, including existing mobile behavior. |

Do not reinterpret “actions do not select” to remove tagging's intended side effect or to fix the pre-existing training target limitation. At most six existing actions are eligible simultaneously (read article without full content); unread articles or fetched articles legitimately have fewer. Selection tests must distinguish callback side effects from article click bubbling.

### 6. Dynamic heights: immediate layout, bounded visual motion

Do not transition height, max-height, grid-template-rows, padding, margin, the measured wrapper, spacer height, or `translateY`. Remove List `transition-all` from the article and scroll viewport. Revealed content enters with an opacity-only keyframe from 0 to 1 using `var(--md-duration-short)` / `var(--md-easing-standard)` (150ms normally, zero with reduced motion/application animations off). Collapse is immediate. Existing content remains in normal flow, so subsequent rows move by the exact measured delta once; there is no overlay, accordion tween, delayed collapse, or long-lived animation frame loop. This bounded reflow is the accepted trade-off for stable reading and virtualization.

Maintain the TanStack observer as the only continuous row observer. Compose the measurement callback rather than replacing it:

```tsx
const rowRef = useRef<HTMLDivElement | null>(null);
const setRowRef = useCallback((node: HTMLDivElement | null) => {
  rowRef.current = node;
  measureElement(node); // registers / removes TanStack observation
}, [measureElement, index]);

useLayoutEffect(() => {
  if (rowRef.current) measureElement(rowRef.current);
}, [expanded, preferences, item.title, excerpt, item.author,
    item.read, Boolean(item.fullContent), imageFailed, measureElement, index]);
```

This skeleton illustrates dependencies; use the memoized resolved preference object rather than constructing a fresh object every render. On disclosure React commits the new intrinsic size; `useLayoutEffect` synchronously measures that mounted wrapper, updating following offsets and spacer before paint. The observer handles later image/font/container changes. Duplicate same-size measurements are harmless (`resizeItem` ignores zero delta). Do not also call `resizeItem`, `.measure()` for all rows, query every row, force `flushSync`, or read/write sizes on every pointer event. Keep `useAnimationFrameWithResizeObserver:false` (the installed default); a delayed animation-frame measurement is undesirable here. Test real browser frames, since jsdom cannot demonstrate non-overlap.

Use `getItemKey` with stable compound identity, e.g. `JSON.stringify([feed.id,item.id])`, through a callback depending on `items`. Use the same compound identity for React keys. Include a memoized **scope key** in the React key so switching between All/Unread/Favorites/feed/folder/reading-list/tag/search/filter/presentation states remounts local disclosure even when the same article survives. Build it from `activeCollectionId`, `viewMode`, `selectedFeed?.id`, `selectedFolderId`, `activeReadingListFeeds?.id` and its sorted feed IDs, sorted `selectedTagIds`, `selectedTagFilter`, `searchQuery`, `intelligenceFilter`, `showDisliked`, `articleLayout`, and resolved display/sort preferences. Do **not** include selected item, `items` array reference, read/favorite changes, scroll position, or menu state. ID+scope React identity prevents disclosure reuse; virtualizer keys remain article-only so measurements follow the same article through sorting. A remounted row immediately replaces any stale expanded measurement with its collapsed measurement.

Keep overscan 10. Use a conservative initial `estimateSize: () => 176` for stacked normal rows with 40px actions; actual size always comes from measurement. This estimate is not a height constraint or promise; content, coarse targets, large thumbnails, and narrow wrapping vary.

Assign the instance property during configuration, not as an unsupported option:

```ts
rssVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (row, _delta, instance) =>
  row.end <= (instance.scrollOffset ?? 0);
```

This corrects only rows wholly above the viewport, preserving the first visible row's screen position. Visible/partially visible hovered rows grow downward without pulling their top away. Browser `overflow-anchor:none` prevents competing native correction. Use no smooth scroll on resize. For selection, skip the DOM `scrollIntoView` effect when `articleLayout==='list'`; the existing List `scrollToIndex(...,{align:'auto',behavior:'auto'})` effect is the sole authority. Ensure it runs when returning to List with the same selected item by including `articleLayout` in its dependencies and gating to List. No scrolling on disclosure and no moving focus to follow hover. Do not reset scroll-to-top on disclosure or ordinary read/favorite updates. Feed changes retain the application's existing navigation policy; do not add selection/scroll redesigns.

### 7. Verification contract and acceptance IDs

Acceptance criteria below are referenced by `tasks.md` and the delta spec. Browser geometry assertions must use real DOM rectangles with a 1px rounding allowance; screenshots alone are insufficient.

| ID | Pass criterion |
| --- | --- |
| AC01 | At actual List widths 320/360/420px, all densities and six eligible commands plus toggle fit without horizontal overflow; title inner width is >=240px at 320 and >=340px at 420. Title occupies its own header row below 720px, including at a desktop viewport with a narrow pane. |
| AC02 | Collapsed title is legible at 14px/20px, wraps naturally and clamps at two lines; expanded title clamps at four. At 720px header switches to two columns and title remains >=240px with all controls; 719px remains stacked. No image/status steals title width. |
| AC03 | A 120ms deliberate fine-pointer dwell reveals allowed excerpt/author; leaving collapses immediately when there is no keyboard/toggle reason. Visits shorter than 120ms and layout-only pointer-enter do not expand. No hover expansion during scrolling or touch input. |
| AC04 | Keyboard Tab entry expands; moving focus into/between actions retains disclosure; Tab out collapses. Escape dismisses without moving focus and does not reopen until a new intentional entry/toggle. Enter/Space operate only the focused native button; external anchor retains native Enter activation. |
| AC05 | Details toggle works with touch, keyboard and pointer; exposes correct localized name/expanded state/region ID. Touch title/body opens on first tap, while details never selects or marks read. Explicit state clears on outside blur, unmount or scope change. |
| AC06 | All eligible six commands remain visible at opacity 1, in order, directly in the header in both states; targets are 40px fine / 48px coarse. Fetch and unread conditions are unchanged. All original titles and handlers are retained. |
| AC07 | Command clicks do not bubble to selection/read logic; tag retains its intentional selected-item/tag-input side effect, training retains its current menu semantics, external prevents default. Favorite/unread/fetch states update correctly and remeasure as necessary. |
| AC08 | Title or noninteractive body activation invokes existing selection/read behavior once, opens desktop reader or mobile reader, and preserves unread-session retention. Selected alone is never a disclosure reason. |
| AC09 | After expansion/collapse, data/content updates, image error/load, preference/width changes, and rapid alternating hovers, each adjacent mounted row top is >= previous row bottom minus 1px; spacer covers the last virtual row. Check each rendered animation frame during transitions. |
| AC10 | Growing/shrinking a fully above-viewport overscan row retains the visible anchor within 1px; changing a visible row leaves scrollTop unchanged within 1px, except existing explicit selection/navigation scrolling. No smooth resize scroll or browser/TanStack double correction. |
| AC11 | With 1,000 deterministic articles, <=60 article cards are mounted in a 420×800 List viewport; repeating a scroll/hover sweep to item 900 keeps rows ordered, reaches the correct item, causes no ResizeObserver loop warnings, and has no disclosure-attributable >50ms main-thread task in a recorded local browser trace. This trace check is manual/local, not a flaky machine-speed CI threshold. |
| AC12 | Switch All/Unread/Favorites/feed/folder/reading-list/tag/filter/sort/display mode while a timer or preview is active: surviving article IDs start collapsed, canceled timers cannot reopen old rows, and no new selection/read writes occur from disclosure. Read/favorite updates in the same scope do not reset focused controls. |
| AC13 | Every preference follows the table, including 50/150/500-character excerpts, compact excerpt opt-out, compact view images hidden, both thumbnail sizes, and author/date/icon off. Missing image/excerpt/author and unbroken long tokens fit. |
| AC14 | Default light/dark and the actual legal-pad preset remain token-compatible; selected/read/unread/focus/hover are distinguishable, actions named and keyboard reachable. Reduced motion and `data-animations=off` make disclosure opacity duration zero; no height/position transition exists in either setting. |
| AC15 | Existing Magazine/Grid geometry, interaction, preference tests and RSS reader selection/context-menu behavior still pass. No new dependency, backend/schema change, global animation rule, or full native build. |

### 8. Targeted tests and minimal commands

**New unit tests:** `src/components/media/__tests__/rssListArticleCard.test.tsx`. Reuse adjacent Testing Library conventions. Use fake timers for dwell/cancellation, `matchMedia` mocks for fine/coarse input, and explicit focus-visible mocking only where jsdom needs it. Cover collapsed/expanded title clamp state, real text content, all six supplied action controls and native propagation, tag's explicit callback behavior, focus-within transitions, pointer-versus-keyboard intent, Escape/toggle suppression, scope remount, timer cleanup, empty/broken image and content, and preference mapping. Mock the `measureElement` callback only to prove it is called after size-affecting commits, not to claim geometry is correct. Add `src/components/media/__tests__/rssKeyboardShortcutProvider.test.tsx` for native keys in the marked card, remapped Space/Enter, Escape routing, and unchanged j/k/Shift+Enter elsewhere. Do not add implementation-mirroring tests for CSS strings in place of browser behavior.

**Browser integration:** add `src/visual/rss-list-disclosure.visual.spec.ts`; extend `src/visual/rssCustomizationHarness.tsx` with two test-only modes. `list-card` renders the production `RSSListArticleCard` inside a `.rss-list-viewport` fixture (`position:relative; height:800px`), width controlled at 320/360/420/719/720/800px, with the six action callbacks supplied through a recorded-action slot, `index=0`, `start=0`, and a recorded measurement callback. `list-stress` renders the **real RSSReader** with deterministic mocked 1,000-item HTTP fixtures. Keep this harness independent of the unrelated RSS selection harness. Reuse the route mocking shape from `rss-customization.visual.spec.ts`; include read/no-full-content fixtures for all six buttons, a long headline, an unbroken token, full-content, no-image, empty-description, and different-author fixtures. Block external image/network dependencies with data URLs or routes. Do not duplicate the virtualizer or force the production pane to 720px: use `list-card` for container breakpoints, real desktop RSSReader for the 420px stress lane, and real 320/390px mobile viewports for mobile navigation (select a feed to enter the items screen before asserting). In every geometry test assert the actual viewport rectangle first, since the desktop flex pane can shrink.

Extend the existing `window.rssHarness` interface (including its declaration in `rss-customization.visual.spec.ts`) with new test controls `setListWidth(width:number)`, `setCardFixture(patch:Partial<FeedItem>)`, `setTheme(id:string)`, and a recorded-action getter; these are proposed harness APIs, not existing application APIs. Existing `setPreferences` supplies the direct card; for real RSSReader, set initial HTTP preferences before mounting and save subsequent changes through its customization UI. Wrap the harness with `ThemeProvider` and `PresentationProvider`, following the verified `src/visual/legalPadHarness.tsx` pattern, and expose `useTheme().setTheme` for actual light/dark/legal-pad application. Do not import the deprecated `components/common/ThemeSystem` provider. Preserve existing harness modes and reload behavior. Real-handler integration tests, not the action-slot fixture, verify tagging/training/selection semantics.

Playwright checks AC01–AC15 where observable: use hover with timed assertions (under 120ms then after dwell), Tab transitions, coarse touch context, browser reduced-motion emulation, real row rectangles on `requestAnimationFrame`, fixed scroll anchor and overscan changes, focus on actions, feed/scope changes with shared IDs, preferences changed through the existing customization UI, and no horizontal overflow. Add a deterministic overscan-height test by fetching full content or changing a specific row fixture while it is wholly above the viewport; do not simulate this by changing all rows and then assert an impossible unchanged anchor. Run default/light/dark with existing theme application and the actual preset from `src/themes/legalPad.ts`, rather than painting a yellow root. Capture representative collapsed/expanded 420px and touch 320px outputs for visual review. Add an action integration case using real RSSReader handlers, especially tagging's deliberate selection and training on the already selected article. Assert next/previous shortcuts and mobile back-to-items still work. Preserve existing Magazine/Grid suite.

Run during **implementation**, from repository root, in this order:

```sh
npx vitest run src/components/media/__tests__/rssListArticleCard.test.tsx src/components/media/__tests__/rssKeyboardShortcutProvider.test.tsx src/components/media/__tests__/rssCustomizationPanel.test.tsx src/types/__tests__/rssCustomization.test.ts src/components/media/__tests__/rssSelectionMenu.test.tsx
npx playwright test src/visual/rss-list-disclosure.visual.spec.ts src/visual/rss-customization.visual.spec.ts
npx tsc --noEmit
npx eslint src/components/media/RSSReader.tsx src/components/media/RSSListArticleCard.tsx src/components/media/KeyboardShortcutProvider.tsx src/lib/i18n/locales/en.ts src/components/media/__tests__/rssListArticleCard.test.tsx src/components/media/__tests__/rssKeyboardShortcutProvider.test.tsx src/visual/rssCustomizationHarness.tsx src/visual/rss-list-disclosure.visual.spec.ts
npm run bench:check
openspec validate improve-rss-article-hover-expansion --strict
```

`bench:check` is the repository gate: all suites, anchor-normalized performance budgets, then bundle budgets. Its final bundle check needs current frontend build output; if absent/stale, prepare it with `npx vite build` and rerun the gate (a frontend bundle only, no sidecar-download prebuild, Tauri, Cargo, AppImage, or installer). Do not update performance/bundle baselines just to silence a regression; an intentional change requires a measured explanation and the corresponding baseline file per `AGENTS.md`. No new microbenchmark is necessary for a CSS/disclosure-only change; browser stress is the relevant additional evidence. `npm run test:scripts` is unnecessary unless gate scripts change. If Playwright's browser is absent, install its existing Chromium with `npx playwright install chromium`; add no package. Report unrelated pre-existing failures separately with evidence; do not rewrite unrelated files to clear them.

Manual confirmation is one bounded desktop/touch/theme batch followed by any necessary fix and one confirmation: hover slowly and rapidly, scroll while hovering, inspect full toolbar at 320/420px, use keyboard without pointer, open/tag/favorite/mark unread, test 200% zoom, switch feeds/preferences, review legal-pad/light/dark, and record the local stress trace. Do not claim motion, scrolling or geometry verified from unit tests alone. The current planning task runs only OpenSpec/document validation; it does not run these future implementation checks or build the application.

## Risks / Trade-offs

- [Expanded rows necessarily move following rows] → One measured size change and an opacity-only reveal; accept a single predictable reflow, never tween intrinsic height. Hover dwell and scroll suppression prevent rapid cascades.
- [Extra visible 40/48px controls cost height at 320px] → Deliberate wrapping within the header; readable title and direct access outrank matching the reference's tiny icons.
- [List compact/tall excerpts previously appeared differently] → Explicit preference table, scoped List changes, compact excerpt opt-out, and unchanged Magazine/Grid behavior.
- [Offscreen cache can remember an expanded height] → Article identity for size caches, scope identity for React, immediate remount measurement, and above-viewport correction. Never cache disclosure globally.
- [ResizeObserver and React/browser timing differ by engine] → Explicit layout-effect measurement, fixed image boxes, no position/height animation, Chromium frame assertions plus manual Tauri WebView smoke check when available; no native build required.
- [Training uses selected article and keyboard coordinates may be zero] → Preserve the original handler and menu contract; known pre-existing limitation, not an unanswered design choice or permission to retarget training.
- [Existing RSS reader and i18n edits overlap] → Patch only the List block, the two selection-scroll guards, keyboard guard, and new dictionary keys. Preserve `articleHtml` memoization and reader text-selection fixes already in the working tree.

## Migration Plan

Implement in `tasks.md` order. No data migration or feature flag: the behavior is built into outer List only, with explicit details access on every input type. Rollback is reverting the scoped component integration/styles/keyboard guard/new strings; preferences and stored articles remain compatible. All architecture decisions are resolved; remaining risks require verification, not redesign.
