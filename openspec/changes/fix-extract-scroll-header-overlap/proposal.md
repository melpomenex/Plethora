## Why

The Extract review screen in scroll mode places the type/state badges and the document-title header in an absolutely positioned band at the top (`absolute top-6 left-6` / `absolute top-6 right-6`), while the centered content column — which starts with the action buttons row ("Create Flashcard...", "Create Cloze (C)", "Create Q&A (Q)") — sits in normal flow. Because the column is vertically centered within the full-height container, the in-flow action buttons collide with the absolutely-positioned header, so the title and labels draw over the buttons. This is a recurring visual bug visible whenever the extract content area is short enough to be centered near the top.

## What Changes

- Restructure the `ExtractScrollItem` layout so the header (badges + document title) and the centered content column no longer share the same vertical space.
- Remove the absolute positioning of the header band and integrate it into the normal document flow, reserving dedicated vertical space for it above the action buttons.
- Keep the badges (extract type, state label, review count, disclosure level) and the document-title / page / save-status row visually grouped as a header, but laid out so they never overlap the action buttons or content editor.
- Preserve the existing gradient background, centered `max-w-4xl` content column, and all current behavior (create flashcard/cloze/QA actions, progressive disclosure, auto-save).

## Capabilities

### New Capabilities
- `extract-scroll-header-layout`: Visual layout contract for the header and centered content of the Extract review screen in scroll mode, ensuring the badge/title header occupies its own space and never overlaps the action buttons or content editor.

### Modified Capabilities
<!-- None. The existing extract editing/interaction capabilities describe behavior, not this layout concern. -->

## Impact

- **Code**: `src/components/review/ExtractScrollItem.tsx` — the outer layout container and the two absolutely-positioned header blocks (badges block and document-title block), plus the centered `max-w-4xl` content column. Changes are confined to the top-level render layout (JSX structure + Tailwind utility classes); no CSS files are involved.
- **Behavior**: No change to functionality — action callbacks, progressive disclosure, auto-save, and i18n labels remain identical. Only the spatial layout of the header relative to the content changes.
- **Risk**: Low. Single component, layout-only. The sibling `FlashcardScrollItem.tsx` already uses a non-overlapping in-flow layout and can serve as a reference pattern.
