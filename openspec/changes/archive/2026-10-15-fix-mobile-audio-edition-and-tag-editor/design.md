## Context

See `proposal.md` - Why.

Current state:
1. `CreateAudioEditionDialog.tsx` returns a non-portaled `div.fixed.inset-0` with `max-h-[90vh]` and `flex-1 overflow-y-auto` missing `min-h-0`. When rendered inside `DocumentsView`, it is enclosed by `.mobile-main-content` which has `height: calc(100% - 56px)` and `overflow: hidden`, sitting below `.mobile-bottom-nav` (`z-index: 1000`). Because the flex container lacks `min-h-0`, the scrollable child expands to full content height, forcing the centered modal to grow beyond the viewport and clip off-screen at both top and bottom with zero scrollability. In addition, `DocumentCard`'s context menu currently lacks the "Create Audio Edition" action that exists in list view.
2. `CompactTagEditor.tsx` renders its edit popover with `className="absolute z-50 mt-1.5 right-0 top-full ... bg-popover"`. In virtualized lists (such as `CompactLibraryView` and Documents list mode), rows have CSS `transform: translateY(...)`, establishing independent stacking contexts. Subsequent rows in DOM order paint on top of the popover. Furthermore, theme custom CSS in jellyfish themes and translucent theme definitions override `.bg-popover` with semi-transparent surfaces or lack solid opaque backgrounds, causing background cards/rows to show through as a jumbled mess. On mobile viewports, the fixed-width inline popover also exceeds screen bounds without responsive repositioning or sheet presentation.

## Goals / Non-Goals

**Goals:**
- Portal `CreateAudioEditionDialog` to `document.body` with `z-[9999]`, dynamic viewport height bounds (`max-h-[min(90vh,calc(100dvh-2rem))]`), outer overlay scrollability (`overflow-y-auto`), and `min-h-0` flex scroll containment so interior content scrolls smoothly on mobile and desktop.
- Adapt `CreateAudioEditionDialog` layout for mobile screens (responsive padding and quality tier grid).
- Add "Create Audio Edition" to `DocumentCard` context menu for non-audio documents.
- Isolate `CompactTagEditor` from parent stacking contexts by rendering the open editor via `createPortal(..., document.body)` with solid opaque background styling, subtle backdrop scrim, proper positioning on desktop, responsive sheet/modal presentation on mobile, and tap-away dismissal.

**Non-Goals:**
- Redesigning the entire Audio Editions generation backend or speech synthesis pipeline.
- Replacing the inline tag editor chip UX in non-compact desktop views (e.g. `ItemTagEditor` in the Inspector).

## Decisions

### Decision 1: Portaling `CreateAudioEditionDialog` to `document.body` with `min-h-0` and dynamic viewport containment
- **Approach**:
  - Render `CreateAudioEditionDialog` using `createPortal(..., document.body)` with `z-[9999]`.
  - Outer container: `fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto`.
  - Modal container: `max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col my-auto`.
  - Content area: `overflow-y-auto min-h-0 flex-1 overscroll-contain` so the flex child shrinks below content size and enables vertical touch and wheel scrolling.
  - Mobile responsiveness: Adapt the 3-column quality tier grid (`grid-cols-1 sm:grid-cols-3`) and dialog padding (`p-4 sm:p-6`) so inputs and text fit comfortably on 360-400px mobile screens.
- **Alternatives Considered**:
  - Full-screen sheet on mobile: Centering a responsive modal with `max-h-[calc(100dvh-2rem)]` and `overflow-y-auto` scroll containment maintains desktop/mobile visual consistency while resolving clipping and unreachable scroll states.

### Decision 2: Stacking Isolation and Mobile Presentation for `CompactTagEditor`
- **Approach**:
  - Render the open "Edit tags" panel via `createPortal(..., document.body)` so it escapes ancestor `transform`, `overflow: hidden`, and virtualized row stacking contexts.
  - On mobile (`isMobile` or screen width < 640px): Present as a bottom sheet or centered floating dialog with a tap-away scrim (`fixed inset-0 bg-black/40 z-[9998]`), thumb-friendly width (`w-[calc(100vw-2rem)] max-w-sm z-[9999]`), and autofocus.
  - On desktop: Position relative to the trigger button using coordinates measured from the trigger's `getBoundingClientRect()`, clamped to the viewport.
  - Guarantee opacity: Apply an explicit opaque background style and solid surface class (`bg-popover border border-border shadow-xl`) with guaranteed opaque background color matching the active theme's opaque popover role (`--color-popover`), preventing see-through bleeding.
- **Alternatives Considered**:
  - Keep `position: absolute` on desktop and only portal on mobile: Leaving `position: absolute` in desktop virtualized tables still allows subsequent virtual rows to paint over the popover because row transforms establish stacking contexts. Portaling solves both mobile and desktop virtual list clipping and stacking issues uniformly.

### Decision 3: Wire "Create Audio Edition" into `DocumentCard`
- **Approach**:
  - Pass `onCreateAudioEdition?: (doc: Document) => void` down to `DocumentCard` and include "Create Audio Edition" in `menuItems` when `doc.fileType !== "audio"`.
  - List mode already exposes this option; bringing it to `DocumentCard` ensures long-pressing in card grid view also lets users create audio editions.

## Risks / Trade-offs

- [Risk] Trigger position measurement for desktop portaled popover could drift if the background page is scrolled while open.
  → Mitigation: Dismiss the popover on window scroll or touchmove outside, and re-anchor on resize.
- [Risk] Existing tests might query the dialog within local container wrappers instead of document root.
  → Mitigation: React Testing Library `screen` queries look at `document.body` by default; verify and adapt tests to assert portaled elements accurately.
