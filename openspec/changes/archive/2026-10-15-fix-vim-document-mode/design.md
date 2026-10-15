## Context

The current `VimCursorEngine` builds one flat token array from mounted DOM nodes. `EpubAdapter` sees the current epub.js iframe; `PdfAdapter` sees rendered pdf.js text layers. The engine stores only a numeric token index and renders a DOM overlay against cached rectangles. This works for static HTML but conflicts with two reader fundamentals: EPUB replaces/reflows contents and PDF virtualizes pages. Rebuilding can give the same index a different meaning, selections cannot reliably span unavailable DOM, and EPUB selection context currently lacks a real CFI range.

The readers already expose the necessary foundations: EPUB locations and rendition lifecycle events, PDF page text layers and page-aware selection rectangles, shared extract/highlight actions, and a modal Vim store. The design preserves these integrations while introducing a stable logical-document layer between motions and rendering.

## Goals / Non-Goals

**Goals:**

- Make the Vim caret visible, stable, and useful throughout navigable EPUB/PDF text.
- Give motions Vim-like semantics across page, section, reflow, zoom, and virtualization boundaries.
- Represent visual selections as durable logical ranges and materialize native DOM selections only for mounted content.
- Produce exact EPUB CFI ranges and PDF page/offset/rectangle context for capture actions.
- Create an elegant, low-noise interface that teaches state and available actions without covering the document.
- Keep keyboard focus, accessibility, native selection, and non-Vim reader behavior safe.

**Non-Goals:**

- Editing or deleting source document text; `d` and `c` remain capture-oriented reader operators rather than mutations.
- Pixel-identical emulation of terminal Vim or support for every Vim command in the first iteration.
- OCR generation for image-only PDFs. Vim mode will explain when no navigable text exists and can use existing OCR text only where it is spatially mapped.
- Persisting an active visual selection across app restarts.

## Decisions

### 1. Stable locations replace global DOM token indexes

Introduce a `DocumentPosition` discriminated union: EPUB positions carry spine item, CFI, local text offset, and quote fallback; PDF positions carry page number, text-item/character offset, and quote fallback. `DocumentRange` stores ordered anchor/head positions plus affinity. The Vim store keeps these positions, while a derived mounted-token index remains an engine cache only.

The adapter contract becomes asynchronous and document-aware: resolve a position, move by a semantic motion, compare positions, obtain text/range context, reveal a destination, and map mounted geometry. This is preferred over retaining a global token index because identity must survive DOM replacement. Quote fallbacks make restoration resilient to small extraction differences without becoming the primary key.

### 2. Each format owns a lazy logical text index

The EPUB adapter indexes spine sections on demand from epub.js contents, caching normalized blocks/tokens and CFI boundaries. It prefetches adjacent section metadata after idle time. The PDF adapter uses pdf.js page text content as the logical source independently of text-layer mounting, caching page token/block maps with a bounded LRU. Both expose the same motion primitives.

An eager whole-book index was rejected because it increases opening latency and memory use. A mounted-DOM-only index was rejected because it cannot make cross-boundary motions deterministic.

### 3. Motions are resolved logically, then revealed and rendered

The engine asks the adapter for a destination. If it is outside mounted content, the adapter navigates/renders that section or page, waits for a lifecycle-ready signal, resolves geometry, then paints the caret. A monotonic navigation request id cancels stale results when keys repeat quickly. While resolving, the last caret remains visible with a subtle traveling pulse on the Reading Rail; input is queued/coalesced rather than lost.

Vertical `j`/`k` uses an x-axis intent captured from rendered geometry and selects the nearest token on the adjacent visual line; at a page/section boundary it carries the intent into the next rendered surface. Word, paragraph, line, document, count, and operator motions use logical blocks.

### 4. Visual mode owns a logical range, not just `window.getSelection()`

Normal mode has one `DocumentPosition`; visual modes add an anchor and moving head. The adapter returns selected text and source context for the complete logical range, including unmounted content. Mounted portions receive native DOM ranges for platform selection rendering; unmounted portions are represented by edge continuation markers and restored when mounted. PDF uses per-page range overlays where a browser Selection cannot span virtualized pages; EPUB uses rendition annotations plus a native range in the active contents document.

This supports reversing direction through the anchor, cross-page/section ranges, and precise capture actions. The selection color remains compatible with themes and persistent highlights but uses a distinct visual-mode treatment.

### 5. “Reading Rail” communicates mode with progressive disclosure

A slim, centered rail floats above the reader bottom safe area and never shifts document layout. It contains a strong mode capsule (`NORMAL`, `VISUAL`, `V-LINE`, `OPERATOR`), human-readable location (`p. 12 · 43%` or chapter label), and pending sequence/count. A real block caret sits on the active glyph/word: calm accent in normal mode, brighter with an anchor notch in visual mode, and hollow while awaiting an operator.

When visual mode contains text, the rail expands into a keyboard-labeled action dock: `Enter Extract`, `E Edit`, `Y Copy`, `H Highlight`, `F Card`, and `: More`. `H` opens a small color strip navigable by home-row keys or arrows; the chosen color is previewed on the selection. Successful actions collapse the dock, return to normal mode at the selection start, and show a short inline confirmation on the rail. Errors keep the selection and offer a retry message. A first-use hint appears once and contextual `?` help reflects only commands valid in the current mode.

The rail is deliberately preferable to a permanent toolbar or command popup: it makes mode errors hard while remaining peripheral during reading. On narrow/mobile layouts it becomes a safe-area-width strip; touch users can tap its actions without disabling keyboard operation.

### 6. Actions consume one canonical range snapshot

Before an action runs, the engine requests an immutable snapshot containing text, ordered positions, and a format-specific `SelectionContext`. EPUB uses `rendition.getRange`/`cfiFromRange` where mounted and the logical CFI boundaries otherwise. PDF resolves every covered page and normalizes text offsets and rectangles. Extract, highlight, copy, and card actions all consume the same snapshot, preventing stale React selection state from disagreeing with the visible range.

### 7. Activation and focus form an explicit state machine

Escape activates Vim only when the reader surface is eligible and no modal, editable field, command palette, native find surface, or accessibility interaction owns focus. Escape then moves visual → normal → inactive. Reader navigation bindings defer whenever Vim is active. Clicking/tapping text moves the Vim caret when active; dragging establishes a visual range; clicking chrome does not silently relocate it. Changing document deactivates the old session, while reflow/zoom preserves the logical position in the same document.

### 8. Instrument lifecycle events instead of polling

EPUB contents/relocated/rendered and PDF text-content/page-render/virtualization signals invalidate only affected geometry and caches. The existing two-second PDF rebuild poll is removed. Resize, zoom, font, and theme changes re-resolve geometry while retaining positions. This reduces churn and eliminates index drift caused by periodic whole-model rebuilds.

## Risks / Trade-offs

- **[Large documents can make indexing expensive]** → Index lazily, prefetch only adjacent regions, use bounded caches, and expose a brief resolving state without blocking input.
- **[EPUB DOM and CFI behavior varies by publisher]** → Normalize text conservatively, keep CFI plus quote/offset fallbacks, and test nested markup, ligatures, ruby text, and split text nodes.
- **[PDF reading order can differ from visual order]** → Prefer pdf.js text-content order with geometry-aware line grouping; preserve a format capability flag and explain unsupported/image-only surfaces.
- **[Cross-page browser selections are impossible with virtualization]** → Treat the logical range as authoritative and render per-surface overlays/continuation affordances.
- **[Async repeated motions can race page turns]** → Use request ids, cancel stale reveals, and coalesce repeatable motions while keeping action commands serialized.
- **[The HUD could distract from reading]** → Keep it compact and translucent, auto-dim after inactivity, fully reveal on state change, and provide reduced-motion/high-contrast variants.
- **[Existing custom shortcuts can conflict]** → Continue routing through the shortcut system, reserve text input contexts, and show the resolved binding in the action dock/help.

## Migration Plan

1. Add position/range types and the new adapter interface while retaining the existing static-document adapters for HTML/Markdown only.
2. Implement PDF and EPUB logical adapters, lifecycle bridges, stable engine/store state, and the Reading Rail/selection renderer.
3. Route actions through canonical snapshots and switch EPUB/PDF atomically to V2 after automated fixture and integration testing passes.
4. Remove PDF polling and the legacy EPUB/PDF index path in the same change so there is only one behavior to maintain. Rollback is reverting the integration commit; persisted documents and highlights require no migration.

## Open Questions

- Whether `d`/`c` should remain aliases for extract/edit-extract or be hidden until a dedicated reader-operator vocabulary is finalized.
- Whether count prefixes and search motions (`/`, `n`, `N`) ship in the initial slice or immediately follow the stable-position foundation.
- Which existing OCR pipeline outputs have sufficiently reliable per-word geometry to opt image-only pages into navigation.
