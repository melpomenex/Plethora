## Context

`ExtractScrollItem.tsx` renders the full-screen Extract review surface shown in scroll mode. Its top-level render (from line 328) is:

```
<div h-full w-full flex flex-col items-center justify-center p-8 gradient>   ← outer wrapper (vertically centers)
  <div absolute top-6 left-6 …>        ← badges block (extract type, state, review count, disclosure level)
  <div absolute top-6 right-6 …>       ← document title + page + save status
  <div w-full max-w-4xl flex flex-col gap-6>   ← centered content column
    <div … Actions Bar>   ← Create Flashcard / Cloze / QA buttons  ← in normal flow, first child
    <div … Content editor / progressive disclosure>
    <div … Notes editor>
    <div … Lifecycle actions (Forget/Dismiss/Done)>
    <div … Rating buttons (Again/Hard/Good/Easy)>
    <div … Keyboard hints>
```

The root cause of the overlap: the outer wrapper uses `justify-center`, so the centered content column is vertically centered in the full viewport height. The two header blocks are absolutely positioned at `top-6`, floating above normal flow. When the extract content is short, the centered column slides upward and its first child — the **Actions Bar** buttons — rises into the same vertical band the absolutely-positioned header occupies. Result: the title and badges paint over the buttons.

This only affects `ExtractScrollItem`. The sibling `FlashcardScrollItem` does not use absolute header positioning, so it is unaffected and serves as a reference for an in-flow header.

No CSS files are involved — all styling is inline Tailwind utility classes.

## Goals / Non-Goals

**Goals:**
- Eliminate the overlap between the header (badges + document title) and the Actions Bar / content column on the Extract review screen.
- Make the layout robust at any content height (short extracts that center high, long extracts that fill the viewport).
- Preserve the existing visual identity: gradient background, `max-w-4xl` centered column, badge colors, and the header's left-badges / right-title arrangement.
- Keep the change isolated to layout (JSX structure + Tailwind classes) in a single component.

**Non-Goals:**
- Redesigning the Extract screen or reordering content sections.
- Changing any action callbacks, progressive-disclosure logic, auto-save behavior, or i18n strings.
- Touching `FlashcardScrollItem.tsx` or any other review component.
- Introducing external CSS files or shared style abstractions.

## Decisions

### Decision 1: Pull the header out of absolute positioning into normal flow

**Choice:** Remove `absolute top-6 left-6` / `absolute top-6 right-6` and render the badges + title as a single in-flow header row at the top of the content column (or as a sibling row directly above the centered column), reserving its own vertical space.

**Rationale:** Absolute positioning was the sole cause of the collision — floating elements can never be pushed by in-flow siblings. Putting the header in normal flow means it occupies real space and the content below it is guaranteed to start lower. This is a structural fix, not a padding hack.

**Alternatives considered:**
- *Add top padding to the centered column to clear the absolute header.* Rejected: brittle — the required clearance depends on header content height (badge text length, presence of disclosure/review-count items), so a fixed padding either wastes space or still overlaps in edge cases.
- *Keep the header absolute but raise the content column's `z-index` above it.* Rejected: doesn't fix the overlap, only changes paint order so buttons sit on top of the title — the title would then be obscured instead. Same bug, mirrored.

### Decision 2: Header layout — single flex row, left-aligned badges, right-aligned title

**Choice:** Render the header as one full-width flex row inside the `max-w-4xl` column: badges grouped on the left (`justify-start`), document title / page / save status on the right (`justify-end`), with the row allowed to wrap on narrow widths. The document title span keeps `truncate` and a bounded `max-w` so a very long title never pushes badges off-row.

**Rationale:** Reuses the existing left/right arrangement the absolute layout already implied, but in-flow. Wrapping degrades gracefully on mobile/narrow widths instead of overflowing. Truncation bounds the title so the row stays predictable.

**Alternatives considered:**
- *Stack badges above the title in two rows.* Rejected: doubles vertical header height and pushes the Actions Bar further down unnecessarily; the single-row layout already reads well.
- *Center the whole header.* Rejected: loses the established left-badges / right-source hierarchy.

### Decision 3: Keep the outer vertical centering on the content column only

**Choice:** The header row sits at the top of the `max-w-4xl` column in normal flow; the column itself remains vertically centered within the outer wrapper (`justify-center`). Because the header is now the first in-flow child of the column, it is always visually attached to the content it labels and moves with it — they can never separate or collide.

**Rationale:** Preserves the pleasant "centered card" feel of the screen for short extracts while guaranteeing the header rides on top of the content block as a unit.

**Alternatives considered:**
- *Change the outer wrapper to `justify-start` (top-align everything).* Rejected: short extracts would slump to the top of the screen, a visible regression of the current intended look.

## Risks / Trade-offs

- **Header consumes a small amount of vertical space on short screens** → acceptable; it is one compact row, and the prior absolute layout only "saved" that space by illegally overlapping it.
- **Very long document titles may truncate earlier** within the bounded `max-w` when sharing a row with badges → acceptable; the title was already truncated before, and the `title`/hover affordance on the span keeps the full text accessible. If needed, a `max-w-2xl` cap on the title group preserves enough room.
- **Narrow/mobile widths** → the flex-wrap header row may stack to two lines; this is the intended graceful degradation and matches the responsive behavior elsewhere in the app.
