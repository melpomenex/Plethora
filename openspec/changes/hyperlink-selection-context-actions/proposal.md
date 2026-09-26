# Hyperlink Selection & Context Actions

## Why

Plethora's product principle is "anything readable in Plethora should also be studyable in Plethora," but today that depends on the source format. Selecting text in an EPUB yields the full contextual action menu (Summarize, Extract, Flashcard, Highlight, Copy, AI actions), while saved web hyperlinks — already captured, sanitized, and rendered by the web article pipeline — only partially participate in the same system. Specific parity gaps verified in the code:

- The V2 selection controller registers the HTML reader iframe without a `buildSelectionContext` callback (`DocumentViewer.tsx:1537-1560`), so web selection context arrives indirectly through the legacy listener path instead of being captured synchronously at settle like EPUB.
- The desktop right-click path for HTML articles discards provenance (`attachHtmlIframeContextMenuListener` sets `selectionContext: null`, `DocumentViewer.tsx:6559`), so extracts and highlights created from it lose their offsets.
- There is no shared selection-action registry: the action set is enumerated independently in `SelectionActionBar`, `SelectionActionsSheet`, and the inline `buildContextMenuItems` in `DocumentViewer` — exactly the duplication the PRD forbids (G4, FR-5).
- Web selection anchors are plain character offsets with no text-quote or selector fallback, so re-import or image-setting changes silently orphan old extracts and highlights; the `ExactSearchHitLocation { kind: "html", selector? }` field exists but is never produced.
- Links inside saved articles have no Plethora routing (no open/import/copy-link handling), and a failed capture from the Android share sheet only shows a toast — the URL itself is never preserved as a source (FR-15 violation).

## What Changes

- **Selection action registry (new shared infrastructure):** consolidate the selection action set (summarize, explain, ask, extract, flashcard, highlight, copy, dictionary, TTS read-from-here, learn-this) into one centralized, type-safe registry module. The anchored bar, mobile action sheet, and desktop context menu all derive their items and dispatch from the registry instead of three parallel inline enumerations. Adding an action becomes one registry entry plus one handler route.
- **HTML selection context parity:** the HTML reader iframe registration gains a `buildSelectionContext` (producing `TextSelectionContext { surface: "html" }` with offsets) so selection capture is synchronous and race-free, matching the EPUB bridge contract.
- **Desktop provenance fix:** the HTML iframe context-menu path captures and forwards the real selection context instead of `null`, so desktop right-click extracts/highlights keep their anchors, same as EPUB.
- **Durable web anchors:** at selection time on HTML surfaces, capture a text-quote anchor (selected text plus prefix/suffix context, and a stable container selector where derivable) alongside offsets. Persist it on the selection context; use it for extract/flashcard source navigation (quote-first resolution, offsets as fast path) and for repainting highlights after content regeneration.
- **In-article hyperlink routing:** intercept link activation inside the reader iframe and route it through Plethora (open in the in-app browser tab or import as a new source), with an open-externally/copy-link affordance, without breaking text selection that spans links.
- **Failed-capture preservation:** when article extraction fails on an unattended import path (Android share sheet, PWA share target), persist the URL as a minimal web source (title = URL, metadata marks `capture_failed`) instead of dropping it; the reader shows the existing capture-failure notice with Retry and Open Original actions.
- **Security non-regression:** canonical articles keep the script-free sandboxed iframe; selection wiring changes must not loosen the sanitizer contract or require `allow-scripts` for canonical articles.

All HTML document kinds (`canonical-article`, `browser-capture`, `raw-fallback`, legacy) render through the same iframe path and inherit these fixes. EPUB, PDF, markdown, transcript, and RSS selection behavior is unchanged (regression-guarded by tests).

## Capabilities

### New Capabilities

- `selection-action-registry`: centralized, type-safe registry of selection actions; all menu surfaces (anchored bar, mobile sheet, desktop context menu) derive items and dispatch from it.
- `web-selection-actions`: saved-web-article selection produces a full-fidelity selection context and exposes EPUB-equivalent action menus on desktop and mobile, including menu lifecycle (update/dismiss/viewport-edge placement), copy preservation, keyboard invocation, and in-article link routing that does not interfere with selection.
- `web-selection-anchors`: durable locators (text quote + prefix/suffix + container selector) for web selections, persisted on extracts/highlights and used for source navigation and highlight repainting across content regeneration.
- `web-link-fallback-source`: a hyperlink whose capture fails is preserved as a minimal readable source with retry and open-original affordances; the URL is never silently lost.

### Modified Capabilities

(none — no existing spec's requirements change; the reader selection system is currently unspecced.)

## Impact

- **Code:** `src/components/viewer/DocumentViewer.tsx` (iframe V2 registration, `attachHtmlIframeContextMenuListener`, `buildContextMenuItems` extraction), `src/components/viewer/selectionInteraction/` (new registry module + bar/sheet consumers), `src/components/viewer/SelectionActionsSheet.tsx`, `src/utils/textHighlights.ts` (anchor capture), `src/utils/cardSourceNavigation.ts` (selector/quote resolution), `src/lib/importRouting.ts` + `src/stores/documentStore.ts` (failure fallback persistence), `src/components/viewer/htmlReader/` (link routing, failure notice).
- **Data:** additive — `TextSelectionContext` gains optional anchor fields; `extracts.selection_context` JSON and persisted highlights store them; `documents.metadata` gains `capture_failed` marker. No migration of existing rows required (old offsets-only contexts keep working via the existing quote fallback).
- **Platforms:** desktop (macOS/Windows/Linux WebView), Android (share sheet + WebView selection), PWA. Sync unaffected (additive JSON fields ride the existing field-group merge).
- **Non-goals:** no live-browser selection changes (`WebBrowserTab` bridge stays), no X-thread viewer migration, no server inbox client wiring, no unification of the extension capture pipeline with the canonical TS pipeline (extension documents benefit via the shared reader path), no editing of original webpages.
