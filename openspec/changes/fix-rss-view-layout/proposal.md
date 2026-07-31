## Why

The RSS View has two layout defects that hurt usability on desktop: (1) the sidebar header toolbar — which holds the Newsletter, Add Feed, Import URL, Scroll Mode, Select Mode, Refresh, and Options buttons — overflows the fixed `lg:w-72` sidebar and spills into the adjacent items-list/article pane, and (2) the feed list in the sidebar does not scroll, so users with many feeds cannot reach them. Both stem from the sidebar column missing `min-w-0` and its header toolbar missing flex-shrink/wrap constraints, leaving the overflow/clamp behaviors that the rest of the three-pane layout relies on broken.

## What Changes

- Add `min-w-0` to the RSS sidebar column (`lg:w-72`) so flexbox can clamp its width to the configured basis instead of growing to fit unshrinkable toolbar content.
- Constrain the sidebar header toolbar (`<div className="flex gap-1">`) so its row of icon buttons no longer overflows: add `flex-wrap` and/or `overflow-x-auto`, mark buttons `flex-shrink-0`, and apply `min-w-0`/`gap` discipline to the title row so the toolbar stays within the `w-72` sidebar bounds.
- Ensure the feed list (`flex-1 overflow-y-auto`) receives a bounded height from its ancestors so vertical scrolling engages for long feed lists — verify the header block above it sits in a non-growing region and that `min-h-0`/`flex-col` chains are intact from the outer container down to the list.
- No functional, data, or API changes — purely CSS/layout utility-class adjustments scoped to `RSSReader.tsx`.

## Capabilities

### New Capabilities
<!-- None. This change fixes existing layout; it introduces no new capability. -->

### Modified Capabilities
- `rss-import-navigation`: extends the existing RSS sidebar requirements to cover correct desktop layout behavior — the sidebar header toolbar stays within the sidebar's width bounds (no spillover into adjacent panes), and the feed list scrolls vertically when content overflows. These are net-new requirements for layout integrity alongside the existing navigation requirements.

## Impact

- **Affected code**: `src/components/media/RSSReader.tsx` — the sidebar column container (~line 1750), the header toolbar cluster (~line 1759), and the feed-list wrapper (~line 2041). No other components or files change.
- **No API/dependency changes**: pure Tailwind utility-class adjustments; no new packages, no Tauri/Rust changes, no data model changes.
- **Risk**: low and isolated to RSS View rendering. Changes are additive CSS constraints (`min-w-0`, `flex-wrap`, `flex-shrink-0`); behavior on mobile (`flex-col`, stacked) is preserved because the fix targets the `lg:` desktop row layout.
- **Specs**: adds layout-integrity requirements to `rss-import-navigation`.
