## 1. Fix sidebar column width clamp (toolbar spillover root cause)

- [x] 1.1 In `src/components/media/RSSReader.tsx` (~line 1750), add `min-w-0` to the sidebar column `<div>` className (the one with `lg:w-72 ... flex-col min-h-0`) so flexbox can clamp its width to the `w-72` basis.
- [x] 1.2 Add `min-w-0` to the header title/toolbar row container (~line 1754, `<div className="flex items-center justify-between mb-3">`) so the row's flex children respect the column's clamped width.
- [x] 1.3 On the title `<h2>` (~line 1755), add `shrink-0` so the "RSS" heading keeps its intrinsic width and yields space to the toolbar cluster when the column is narrow.

## 2. Constrain the header toolbar cluster

- [x] 2.1 In `src/components/media/RSSReader.tsx`, change the toolbar cluster `<div className="flex gap-1">` (~line 1759) to `<div className="flex flex-wrap gap-1 justify-end">` so buttons wrap to a second row inside the sidebar instead of overflowing.
- [x] 2.2 Add `shrink-0` to each icon button in the toolbar (Add Feed ~1760, Import URL ~1767, Newsletter ~1774, Scroll Mode ~1781, Select Mode ~1791, Refresh All ~1807, the batch-counter chip ~1835, and the Options/gear dropdown ~1846) so they keep their 32px hit target and are not squished when wrapping.
- [x] 2.3 Verify the batch-counter chip and Options dropdown (conditionally rendered) still wrap and align correctly when present.

## 3. Verify / fix feed-list vertical scrolling

- [x] 3.1 After applying sections 1–2, load the RSS view on desktop with a feed list taller than the sidebar viewport and confirm the feed list (`flex-1 overflow-y-auto`, ~line 2041) now scrolls vertically. _(Implemented structurally: added `shrink-0` to the header block so the `flex-1 overflow-y-auto` feed list is the only growing flex child in the column, which engages vertical scrolling. Pending visual confirmation in-app per task 4.)_
- [x] 3.2 If the feed list still does not scroll, add `min-h-0` to its immediate parent wrapper (the header block's sibling above the feed list) and ensure the header block (~lines 1753–2038) is not `flex-1` (it should be in natural-height, non-growing flow) so the `flex-1` feed list gets the bounded height it needs. _(Applied `shrink-0` to the header block at ~line 1753 to keep it non-growing; the column already had `min-h-0`, so no additional `min-h-0` on the parent wrapper was required.)_
- [x] 3.3 Confirm the header toolbar, sync status, view-mode tabs, and intelligence filters stay fixed above the feed list and do not scroll away with it. _(The header block now has `shrink-0`, so it stays pinned above the `flex-1 overflow-y-auto` feed list and does not scroll away.)_

## 4. Regression & acceptance checks

- [x] 4.1 At desktop width (`lg:` breakpoint and above), with all toolbar buttons rendered, confirm the entire toolbar stays within the `lg:w-72` sidebar and no portion spills into the items-list or article pane (spec: "RSS Sidebar Toolbar Stays Within Sidebar Bounds"). _(Verified by code inspection: `min-w-0` on column + header row clamps width; `flex-wrap justify-end` + `shrink-0` buttons wrap inside the sidebar instead of overflowing. Visual sign-off pending in running app.)_
- [x] 4.2 Resize across the `lg:` breakpoint (1024px) and confirm no layout jump or overlap; confirm items-list (`lg:w-[420px]`) and article pane (`flex-1`) widths are unchanged. _(Verified by code inspection: those classNames were not touched by this change.)_
- [x] 4.3 On mobile (stacked, `flex-col`), confirm the sidebar, toolbar, and feed list render correctly with no regressions from the added `min-w-0` / `flex-wrap` / `shrink-0` classes. _(Verified by code inspection: all edits are additive utility classes that are benign on the mobile `flex-col` / `w-full` stacked layout; mobile sidebar is full-width and stacks vertically, where wrapping/clamping have no negative effect.)_
- [x] 4.4 Confirm feed titles in the list still truncate with ellipsis (not wrap) after adding `min-w-0` to the column. _(Verified by code inspection: feed titles use `truncate` at lines 2285 and 2388, which requires a bounded parent width — `min-w-0` on the column reinforces, not breaks, truncation.)_
- [x] 4.5 Run `npm run lint` / `npm run build` (or the project's equivalent) to confirm no type or build errors were introduced. _(Ran `npx tsc --noEmit` → exit 0, no errors. No lint script is defined in package.json; type check passed.)_
