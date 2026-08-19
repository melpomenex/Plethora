# Proposal: unify-selection-dictionary-lookup

## Why

Dictionary lookup works in the Documents reader but silently misbehaves or disappears in the Queue reader because it was never integrated into the shared selection stack: it exists as two hand-rolled, surface-local implementations (a context-menu row + floating result card inside `DocumentViewer.tsx`, and an RSS-only drawer replica inside `QueueScrollPage.tsx`), while the shared V2 selection surfaces (`SelectionActionBar`, `SelectionActionsSheet`) have no dictionary action at all. On the default mobile config the split is concrete: Documents' selection-bar overflow opens the shared `ContextMenu` (which has a Dictionary row), while Queue's overflow opens `SelectionActionsSheet` (which has none), and the Queue's only dictionary entry point is gated `renderedItem?.type === "rss"` — so dictionary availability depends on *which reader shell* launched the content instead of on the selection itself.

## What Changes

- **Fix the Queue dictionary bug at the architecture level**: dictionary lookup moves out of reader-local implementations into the shared selection-interaction layer (`src/components/viewer/selectionInteraction/`), so every surface using that layer (Documents, Queue Scroll Mode, EPUB, PDF fixed/reflow/OCR-HTML, Markdown, HTML, RSS) gets identical behavior.
- **New selection-intent resolver**: a pure, Unicode-aware module (`Intl.Segmenter` with fallback) that classifies a *settled* selection as single-lexical-word / phrase / URL / other. It replaces the triplicated naive `text.trim().split(/\s+/)[0]` heuristic (DocumentViewer ×2, QueueScrollPage ×1) and strips surrounding punctuation without breaking `can't` / `mother-in-law` / `résumé` / CJK.
- **Long-press + release on a single word auto-opens a new shared "Dictionary Peek"**: intent resolution runs when the selection controller reaches its READY phase (which by construction waits for the gesture to finish — stability after touch release), so dictionary never opens mid-drag; any selection expansion demotes the machine out of READY, which closes the Peek and lets normal multi-word selection UX take over. Multi-word selections keep the existing `SelectionActionBar` / `SelectionActionsSheet` flow unchanged.
- **New `DictionaryPeek` component** (shared, portaled, anchored): word, phonetics, part of speech, concise definition, optional async "in this passage" AI explanation (non-blocking, purely additive — the dictionary itself never depends on an LLM), and secondary actions Pronounce (existing `useTTS`), Extract (existing `createInstantExtract`), Flashcard (programmatic `createLearningItem` + toast, precedent already exists in DocumentViewer), Explain-in-context (existing `passageAI.explainPassage`), and More (overflow into the standard selection actions). Desktop: anchored popover (auto-open on double-click single word only, not on dragged mouse selections); mobile: compact anchored card; e-ink: same card with transitions disabled. Both existing hand-rolled dictionary UIs (DocumentViewer legacy card, QueueScrollPage RSS popup) are deleted in favor of this one component.
- **Dictionary service hardening**: `src/utils/dictionaryLookup.ts` is promoted to a cached service (React Query) that preserves provider phonetics/part-of-speech (currently discarded), normalizes the query word, and renders explicit failure states ("No dictionary entry found for …" with fallback actions) instead of failing silently; the provider stays online (dictionaryapi.dev + Datamuse) with caching making repeat lookups offline-capable — documented as a known limitation, not fixed by this change.
- **Dictionary added to `SelectionActionsSheet`** as an explicit row (accessibility/fallback path; also fixes the Queue overflow having no dictionary at all), and the `ContextMenu` Dictionary row is retained but rewired to the shared resolver + Peek.
- **Minimal vocabulary-lookup history**: a persisted local store records word lookups (word, count, last-seen, source document) with no automatic flashcard creation and no queue mutation — the extension point for a future Vocabulary mode.
- **Queue lifecycle safety is specified and tested**: dictionary interactions must not complete/rate/advance/dismiss queue items, remount the reader, or reset scroll/reflow state.

Non-goals: no offline dictionary database, no PDF.js-native-selection rework beyond existing commit paths, no in-app-browser/webview selection changes, no full controller adoption inside `XThreadViewer`/`RSSScrollMode` beyond shared resolver + Peek reuse, no analytics (none exist in-app today), no auto-creation of learning items from lookups.

## Capabilities

### New Capabilities

- `selection-intent-resolution`: centralized, Unicode-aware classification of settled text selections (single lexical word / multi-word / URL / other) with trigger-on-settle timing, expansion cancellation, and the requirement that the same resolved intent produces the same action on every reading surface (Documents, Queue Scroll Mode, EPUB, PDF fixed/reflow/OCR-HTML, Markdown, HTML article, RSS article reader).
- `dictionary-peek`: the compact dictionary UI and its backing cached dictionary service — presentation per platform (desktop popover, mobile anchored card, e-ink adaptation), dismissal/selection-persistence semantics, LLM-independence with optional async contextual explanation, secondary actions (Pronounce / Extract / Flashcard / Explain / More), failure states, and reading-position/queue-state preservation.
- `vocabulary-lookup-history`: minimal local recording of dictionary lookups (no auto-learning-item side effects) as the extension point for a future Vocabulary review mode.

### Modified Capabilities

(none — no existing archived spec covers reader selection or dictionary behavior)

## Impact

- **Code**: `src/components/viewer/selectionInteraction/` (new intent module, Peek component, READY-phase wiring in `useSelectionInteraction`), hosts `src/components/viewer/DocumentViewer.tsx` and `src/pages/QueueScrollPage.tsx` (delete local dictionary UIs, mount shared Peek, unify overflow), `src/components/viewer/SelectionActionsSheet.tsx` (add Dictionary row), `src/components/viewer/MarkdownViewer.tsx` / `EPUBViewer.tsx` / `PDFViewer.tsx` (verify READY commits flow through intent), `src/components/media/RSSScrollMode.tsx` and `src/components/viewer/XThreadViewer.tsx` (adopt resolver + Peek without full controller migration), `src/utils/dictionaryLookup.ts` (cached service + richer result), `src/stores/settingsStore.ts` (feature flag), `src/lib/i18n/locales/*` (6 locales), `src/stores/` (new vocabulary history store), `src/main.tsx` (query key).
- **Behavioral risk**: the READY phase currently renders `SelectionActionBar`; single-word READY will render Peek instead — regression risk for multi-word flows is the core test target, plus Android WebView selection quirks (never call `removeAllRanges` on touch), pdf-fixed touch settle, and EPUB iframe geometry for Peek anchoring.
- **No API/database migrations** (history store is localStorage-persisted); no new dependencies.
