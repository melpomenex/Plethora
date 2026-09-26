# Design: Hyperlink Selection & Context Actions

## Context

The selection stack is already surface-agnostic: `src/types/selection.ts` defines the `SelectionContext` union (with `TextSelectionContext.surface = "html"`), and the V2 controller (`src/components/viewer/selectionInteraction/`, default-on via `selectionInteractionV2` in `settingsStore.ts:1328`) drives an anchored bar + action sheet on touch and supports iframe bridges via `registerContentDocument({ doc, win, offset, buildSelectionContext })` — EPUB already passes a CFI-producing `buildSelectionContext`; the HTML iframe registration (`DocumentViewer.tsx:1537-1560`) does not. Desktop menus are built by the inline `buildContextMenuItems` (`DocumentViewer.tsx:2546`), and the HTML right-click path forwards `selectionContext: null` (`DocumentViewer.tsx:6559`). Web anchors are flattened character offsets (`buildTextSelectionContext`, `src/utils/textHighlights.ts:18`); navigation already distrusts them and falls back to uniqueness-gated quote matching (`cardSourceNavigation.ts:137-158`), but nothing persists a quote at capture time and `ExactSearchHitLocation { kind: "html", selector? }` is never populated. See proposal.md for why these gaps matter.

Constraints that shape the design: `DocumentViewer.tsx` is ~9k lines and the single host for all document surfaces; Android WebView selection has a large set of existing workarounds that must not be duplicated; `inlineDynamicImports: true` means no new lazy chunks; the performance benchmark gate (`npm run bench:check`) covers selection-path code.

## Goals / Non-Goals

**Goals:**
- One shared, statically-typed selection-action registry consumed by bar, sheet, and context menu.
- HTML selections captured through the same synchronous bridge contract EPUB uses.
- Durable quote anchors persisted with extracts/highlights and used for navigation and repaint.
- In-article link routing and capture-failure preservation, without loosening the sanitizer/sandbox boundary.

**Non-Goals:**
- Migrating the X-thread viewer or the live-browser extract bridge onto the registry.
- Unifying the Rust extension-capture pipeline with the TS canonical pipeline (extension documents benefit via the shared reader path).
- Auto-opening a menu on keyboard-only selection on desktop (keyboard navigation of an *opened* menu is in scope).
- Server inbox client wiring.

## Decisions

### D1: Static typed registry module, not runtime plugin registration

Create `src/components/viewer/selectionInteraction/selectionActionRegistry.ts` exporting a `SelectionActionDescriptor` union (id, label key, icon, `isAvailable(selectionContext, surface)`, dispatch target) plus a `getActionsFor(context, surface)` helper. The bar (`SelectionActionBar.tsx`), the sheet (`SelectionActionsSheet.tsx`), and `buildContextMenuItems` derive their items from it; handlers stay in `DocumentViewer` (they close over viewer state) and are registered in one `actionId → handler` map, mirroring the pattern already specced for the command palette (`contextual-palette-actions`).

*Why static:* all consumers are compile-time known; a static union gives exhaustiveness checking (misspelled id = compile error) and matches the codebase's existing "single shared module" precedent. Runtime registration was considered and rejected — indirection with no plugin use case. A Context/provider-based registry was rejected because there is exactly one host.

*Migration discipline:* extract the registry in a behavior-preserving first step (same actions, same order, same gating), guarded by parity tests, before adding any new wiring. This is the highest-regression-risk step of the change.

### D2: HTML selections use the existing bridge's `buildSelectionContext`

Extend the HTML iframe registration to pass `buildSelectionContext: (range, selection) => buildTextSelectionContext(doc, range, selection)` (extended per D3), exactly like the EPUB bridge. The context is then captured synchronously at settle in `CapturedSelection`, removing the dependency on the legacy `updateSelection → setLiveSelectionContext` path. The legacy listener stays as fallback for the flag-off configuration; it is not removed in this change.

*Alternative rejected:* keeping the legacy listener as the source of truth — it races the settle phase and is the reason desktop capture can miss context.

### D3: Anchor shape — additive optional field on `TextSelectionContext`

```ts
interface WebSelectionAnchor {
  textQuote: { exact: string; prefix: string; suffix: string }; // prefix/suffix bounded (~64 chars)
  selector?: string;      // stable container path within .inc-body, hint only
  sectionHeading?: string;
}
// TextSelectionContext gains: anchor?: WebSelectionAnchor
```

Captured inside `buildTextSelectionContext` (zero extra passes over the DOM — it already walks text nodes for offsets). Persisted for free: extracts already serialize `selection_context` to JSON; sync already merges that column. `locatorFromSelectionContext` learns to emit `{ kind: "html", textQuote, selector }` from the anchor, and `countQuoteMatches` continues as the uniqueness gate for resolution.

*Why not CSS-selector-only anchors:* the canonical `inc-article` shape makes selectors plausible, but re-import regenerates markup; quotes degrade gracefully while selectors alone do not. Selector is kept as a hint for repaint scoping.

### D4: Highlight repaint resolves offsets-first, quote-fallback

`applyAnchoredTextHighlights` gains an optional anchor parameter: when offset application does not reproduce the stored `selectedText` (its existing validation signal), re-resolve via bounded quote search within the selector scope (or whole body) and paint there; unresolved anchors are skipped. Uniqueness gating prevents painting on the wrong repetition.

### D5: In-article links — parent-side interception, in-app routing

Attach a click interceptor to the iframe document alongside the existing selection listeners (same-origin iframe, no scripts needed): same-document fragment links (`#fn-...`) navigate natively; external links are prevented from navigating the iframe and routed to a link handler that opens the in-app browser tab by default, with Save to Plethora (runs the import pipeline), Open externally, and Copy link in a small menu (desktop: link right-click when no text selection; mobile: long-press on a link). Link schemes are filtered to the sanitizer's existing URL policy at click time; `javascript:` and unknown schemes never activate.

*Alternative rejected:* rewriting anchors to `target="_blank"` at prepare time — hands off to the OS browser by default and loses the Save-to-Plethora affordance.

### D6: Capture-failure preservation — minimal source record, not a retry queue

`processSharedBatch`'s catch path (and the PWA share-target equivalent) calls a new `persistWebArticleFailure(url, reason)`: create a document (`file_type: "html"`, title = URL, `metadata.captureFailed = { reason, at }`, content = failure placeholder) so the link lands in the library. `classifyHtmlReader` gains a `capture-failed` kind rendering the existing notice pattern with Retry (re-runs `importCanonicalArticle` and updates the *same* document via a `persistWebArticleOutcome` variant that takes an existing docId) and Open Original. Dedupe rides the existing `find_document_id_by_source_url`. The interactive import dialog keeps its current typed-error/raw-fallback flow unchanged.

*Alternative rejected:* a pending-shares-style retry queue — the PRD requires the URL to remain visible in the library, and a queue is invisible state.

### D7: Security boundary unchanged

All new wiring lives in the parent app or the same-origin, script-free iframe. Canonical articles keep `sandbox="allow-same-origin"`; no change to the DOMPurify contract in `sanitizer.ts` or to `prepareHtmlDocument`'s script/style stripping. Link interception filters schemes; nothing in the selection path evaluates captured strings. The menu presentation path performs no I/O (spec: "Opening the selection menu performs no network access").

### D8: Usage-ranked bar ordering — local, content-free counts with a cold-start threshold

The anchored bar scrolls horizontally, so chip position is reach. `selectionActionUsage.ts` keeps per-action invocation counts in a small persisted store (`plethora-selection-action-usage`, localStorage — deliberately NOT part of cross-device sync), recorded at every dispatch surface: the bar's own chips, the sheet's rows, and the desktop context-menu handlers. The bar ranks its availability-filtered actions most-used-first only after `BAR_ADAPTATION_MIN_INVOCATIONS` (8) total invocations; below the threshold, and for all ties, the canonical registry order stands (stable sort), so the bar never jump-reorders during early use or between equals. Popularity never weakens availability gating — ranking is applied after filtering. Counts record action ids only, never selected text (privacy per PRD §26).

*Alternative rejected:* recording only bar invocations — a user who extracts via the ⋯ sheet or desktop menu would see no adaptation on mobile. *Alternative rejected:* syncing counts across devices — one device's usage shouldn't surprise another's muscle memory, and it avoids new sync surface.

## Risks / Trade-offs

- [Registry extraction regresses EPUB/PDF/markdown menus] → behavior-preserving first step + parity tests per surface; spec scenario "EPUB selection menu keeps its full action set" is the guard.
- [Quote anchors grow `selection_context` payloads] → bounded prefix/suffix; `exact` already stored as extract text.
- [Quote repaint paints the wrong repetition] → uniqueness gate; ambiguous matches are skipped, never guessed.
- [Link interception breaks footnote/back-links] → only same-document fragments navigate natively; everything else is routed.
- [Two devices retry a capture-failed source concurrently] → last-write-wins via the existing field-group merge; acceptable (content is deterministic-ish, provenance records the winner).
- [Android WebView selection quirks resurface via the new context builder] → the builder runs inside the existing settle pipeline (no new listeners, no new timing); the existing workaround suite (touch dismissal gates, defer loop) is untouched.
- [Selection-path cost changes trip the bench gate] → run `npm run bench:check`; any intentional change updates `scripts/perf-baselines.json` in the same PR per repo policy.

## Migration Plan

Additive only: new optional JSON fields (`anchor`, `captureFailed`) and one new `documents.content` placeholder for failures. No DB migration; pre-existing offsets-only contexts keep resolving via the existing fallback (specced). Rollback is revert — no flags added; the existing `selectionInteractionV2` setting continues to gate the mobile bar/sheet for html as today.

## Open Questions

- Default action for in-article link *taps on mobile* (in-app browser tab vs. import prompt) — depends on how the browser tab surface behaves on the mobile shell; either choice satisfies the spec, decide during implementation.
- Whether `selector` capture is worth its (small) cost for legacy `browser-capture`/`raw-html` kinds whose markup is less predictable — start with quote-only there.
