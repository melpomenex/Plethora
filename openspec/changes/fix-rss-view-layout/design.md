## Context

The RSS View (`src/components/media/RSSReader.tsx`) renders a three-pane desktop layout inside a single flex row (`lg:flex-row`) at line 1747:

```
[ Sidebar lg:w-72 ] [ Items list lg:w-[420px] | Article pane flex-1 ]
```

The sidebar column (line 1750) holds, top-to-bottom: a header block (title + toolbar + sync status + view-mode tabs + intelligence filters), then the feed list (`flex-1 overflow-y-auto`, line 2041). The header toolbar (`<div className="flex gap-1">`, line 1759) packs up to eight `p-2` icon buttons (Add, Import URL, Newsletter, Scroll Mode, Select Mode, Refresh, batch counter, Options) into a single non-wrapping row.

Two defects are observed on desktop:

1. **Toolbar spillover**: The toolbar cluster has no `flex-wrap`, no shrink control, and the sidebar column lacks `min-w-0`. In flexbox, `w-72`/`lg:w-72` is a *basis*, not a hard cap — without `min-width: 0` on the flex item, the column grows to fit its unshrinkable content (the wide toolbar row), and the toolbar visually overflows the `w-72` border into the items-list pane.
2. **Feed list does not scroll**: The `flex-1 overflow-y-auto` feed list only scrolls if it receives a bounded height from ancestors. With the outer container using `overflow-hidden` (line 1747) and the header block competing for vertical space, the feed list's flex region can collapse so scrolling never engages.

This is a pure layout/CSS fix — no data, API, or component-architecture changes.

## Goals / Non-Goals

**Goals:**
- Keep the entire sidebar header toolbar within the `lg:w-72` sidebar bounds on desktop, eliminating spillover into adjacent panes.
- Make the feed list scroll vertically when feeds exceed the available height.
- Preserve the existing mobile layout (`flex-col`, stacked panes) and all existing toolbar functionality.
- Keep changes isolated to Tailwind utility classes in `RSSReader.tsx`.

**Non-Goals:**
- Refactoring the toolbar into a separate component or dropdown menu (out of scope; the inline structure stays).
- Changing sidebar width (`lg:w-72`) or items-list width (`lg:w-[420px]`) values.
- Redesigning the three-pane layout, reordering panes, or adding collapsibility controls.
- Touching the article pane or items-list pane internals beyond what's needed to keep the overall row clamped.

## Decisions

### Decision 1: Add `min-w-0` to the sidebar column (and to the header row container)
**Choice**: Add `min-w-0` to the sidebar column at line 1750 and to the header title/toolbar row.

**Rationale**: The root cause is that a flex item's `min-width` defaults to `auto` (content-based), which prevents the item from shrinking below its content's intrinsic width. Adding `min-width: 0` (`min-w-0`) is the canonical fix that lets `lg:w-72` act as a real clamp. This is the minimal, idiomatic Tailwind fix and matches the pattern already used elsewhere in `src/index.css` (generic `min-width: 0` layout helpers).

**Alternatives considered**:
- *Reduce the number of visible toolbar buttons (move some into a "More" menu).* Rejected — changes product behavior/UX, out of scope for a layout fix, and the toolbar already has an Options/gear dropdown.
- *Increase sidebar width to `lg:w-80`+.* Rejected — masks the symptom, breaks the spec'd `w-72` design, and does not fix the missing `min-w-0` that will bite again if buttons are added later.

### Decision 2: Make the toolbar cluster wrap, and mark buttons non-shrinkable
**Choice**: Change the toolbar `<div className="flex gap-1">` (line 1759) to add `flex-wrap` and apply `flex-shrink-0` to each icon button so they keep their hit target size; let the cluster wrap to a second row inside the sidebar when needed rather than overflowing.

**Rationale**: `min-w-0` alone lets the column clamp, but the toolbar content still needs somewhere to go. `flex-wrap` keeps buttons fully visible and clickable inside the sidebar instead of clipping them with `overflow-hidden` (which would hide buttons past the edge — unacceptable for a primary action row). `flex-shrink-0` on buttons prevents them from being squished into unusable tap targets.

**Alternatives considered**:
- *`overflow-x-auto` on the toolbar (horizontal scroll).* Rejected as primary mechanism — discoverability is poor (users won't know to scroll for the Newsletter/Options buttons). Could be acceptable as a fallback, but wrapping is clearer.
- *Two fixed rows (hard wrap at a known button index).* Rejected — brittle if buttons are conditionally rendered (batch counter, select mode toggles).

### Decision 3: Verify (not change) the height chain for the feed list
**Choice**: After applying the width clamp, confirm the feed list `flex-1 overflow-y-auto` (line 2041) receives a bounded height. The sidebar column already has `min-h-0` and `flex-col`, and the header sits above `flex-1` in the column — so once the toolbar no longer forces the column to overflow horizontally (and thus the `overflow-hidden` on the outer row stops clipping the column's layout box), the vertical scroll region is expected to engage. If, during implementation, the feed list still does not scroll, add `min-h-0` explicitly to the immediate parent of the feed list and ensure the header block is not itself `flex-1`.

**Rationale**: Avoid speculative edits. The width spillover and the `overflow-hidden` on the outer container (line 1747) are the most plausible reason the feed list's flex region is being collapsed/hidden; fixing the width first isolates the true cause.

**Alternatives considered**:
- *Give the feed list a fixed `max-h`.* Rejected — non-responsive, breaks on different viewport heights.
- *Wrap the header in `shrink-0` and the list in a `min-h-0` flex child explicitly.* Acceptable as a follow-up only if needed.

## Risks / Trade-offs

- **[Toolbar wraps to two rows on narrow desktop windows]** → Mitigation: acceptable and intentional; buttons stay visible and reachable. The header block already has `pb-3` and gradients; a second toolbar row is visually consistent. Verify the wrapped layout does not push the feed list out of view (the list is `flex-1` and will shrink, which is fine because it scrolls).
- **[`min-w-0` could interact with text truncation elsewhere in the sidebar]** → Mitigation: the sidebar's text content (feed titles in the list) already has its own truncation handling; adding `min-w-0` to the column/header row does not affect list-item internals. Verify feed titles still truncate with ellipsis, not wrap.
- **[Mobile layout regression]** → Mitigation: all changes are additive utility classes that apply uniformly to `flex-col` (mobile) and `lg:flex-row` (desktop); `min-w-0` and `flex-wrap` are benign on the stacked mobile layout. Verify the mobile (stacked) view still renders correctly.
- **[Fix is verified only by visual inspection]** → Mitigation: implementer should resize the window across the `lg:` breakpoint and test with both few and many feeds; the spec scenarios encode these as acceptance checks.

## Migration Plan

Not applicable — pure front-end layout change with no data, API, persistence, or dependency migration. The change ships in a normal release; no rollback strategy is needed beyond reverting the utility-class edits in `RSSReader.tsx`.

## Open Questions

- None blocking. The investigation confirmed the cause and the fix locations. During implementation, the only thing to confirm empirically is whether the feed-list scroll engages after the width clamp (Decision 3) — if not, apply the explicit `min-h-0` follow-up noted there.
