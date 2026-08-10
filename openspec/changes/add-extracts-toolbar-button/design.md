## Context

`src/components/Toolbar.tsx` renders a single `buttons: ToolbarButton[]` array in two layouts: a vertical rail (`position === "left" | "right"`) and a horizontal strip (`"top"`). Each button is a `ToolbarButtonItem` with a Phosphor icon, a native `title` tooltip, an `aria-label`, and an `sr-only` label span. Styling lives in `src/index.css` under `.toolbar-button*`, already keyed by `data-toolbar-orientation`.

Extract data already exists library-wide: `getExtracts(documentId)` in `src/api/extracts` accepts a null/empty filter and `useExtractStore.loadExtracts(documentId?)` passes `documentId ?? null`. `ExtractsList` is per-document (`documentId: string` required), and `DocumentExtractsTab` wraps it for one document. `ExtractInbox` renders a cross-document list (`getExtracts("")`) with AI actions but is currently not mounted anywhere.

## Goals / Non-Goals

**Goals:**
- One toolbar entry point to all extracts in the library.
- Labels discoverable without waiting on native tooltips, for pointer and keyboard users alike.
- Zero content reflow and no layout thrash when the toolbar expands.

**Non-Goals:**
- Redesigning extract cards, or adding search/filter/sort/bulk actions to the extracts list — a flat recency-ordered list is the deliverable.
- A pinnable/persisted "always expanded" toolbar mode.
- Touch/mobile behavior: the mobile shell uses its own navigation and is untouched.
- Reviving `ExtractInbox`'s AI analysis panel.

## Decisions

**Extracts tab reuses `ExtractsList`, not `ExtractInbox`.** `ExtractsList` is the surface users already know from the document viewer, is actively maintained, and carries selection/source-context behavior. `ExtractInbox` is unmounted dead code carrying an AI-analysis panel that is out of scope; reviving it would mean re-testing an unused component. `ExtractsList` requires a `documentId`, so `ExtractsTab` groups the library-wide result by source document and renders headed sections rather than passing a fake id. *Alternative considered:* mount `ExtractInbox` as-is — rejected, it drags in scope (AI calls, its own fetch path) for a list we can compose from the live component.

**Load through `useExtractStore.loadExtracts()` with no argument.** The store already handles the null-document case and is shared with the command palette, so the palette's lazy extract load and this tab warm the same cache. *Alternative:* a direct `getExtracts(null)` call in the tab — rejected, it duplicates loading/error state the store owns.

**Expansion is CSS-driven, state is one boolean.** A single `expanded` state on `Toolbar` (set by `onPointerEnter`/`onPointerLeave` with timers, and `onFocus`/`onBlur` via `focusin`/`focusout` on the container) toggles a `data-expanded` attribute; all widths, label opacity, and transitions live in `src/index.css`. *Alternative:* animate per-button in JS or use a tooltip library — rejected, more code and worse for 18 simultaneous labels.

**Overlay, not push.** The rail keeps its collapsed width in flow (`width: var(--toolbar-rail-w)`) and the expanded surface is `position: absolute` inside it with a shadow, so the content area never reflows. Reflowing an editor/PDF viewport on hover is the single worst failure mode here. For `top`, the strip keeps its collapsed height and the expanded row overlays downward.

**Open delay ~120 ms, close delay ~250 ms.** Asymmetric delays are the standard fix for flap: crossing the rail on the way to content must not trigger it, but small pointer excursions off the rail must not collapse it mid-reach. Both are constants at the top of `Toolbar.tsx`.

**Labels use the existing `sr-only` span; the visible label is `aria-hidden`.** Buttons keep `aria-label`, so the accessible name is identical collapsed or expanded and nothing is announced twice. The native `title` is dropped when expanded (keep it collapsed) so the OS tooltip does not fight the visible label.

**`prefers-reduced-motion: reduce` disables the width/opacity transition** in CSS only — the expanded/collapsed states themselves still work.

## Risks / Trade-offs

- **Overlaying the content hides the top-left of the viewport while expanded** → the overlay is transient (collapses on leave) and only ~180 px wide; it never intercepts clicks outside its own bounds.
- **`focusin`-driven expansion means tabbing through the toolbar expands it** → that is the intended keyboard parity; focus leaving the container collapses it immediately (no close delay for focus, so it does not linger after tabbing out).
- **A library with thousands of extracts makes the tab slow** → the list renders the store's already-loaded array; if this becomes a problem it is a windowing change inside `ExtractsTab` only. Marked with a `ponytail:` comment rather than pre-solved.
- **Six locale files must all gain the new keys** → missing keys fall back to the key string, which is visible but not fatal; the i18n key-parity test in the repo covers this.
