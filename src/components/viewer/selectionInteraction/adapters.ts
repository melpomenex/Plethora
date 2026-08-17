/**
 * Event adapters for the selection-interaction controller (change:
 * overhaul-reader-selection-ux, design decision 7).
 *
 * The controller owns the phase logic; adapters only SOURCE events and
 * translate coordinates:
 *  - `attachTopDocumentAdapter` — generalizes the DocumentViewer stability
 *    effect (selectionchange / touch* capture / capture-phase scroll gate) to
 *    reflow PDF, markdown, OCR-HTML and the secondary hosts.
 *  - `attachContentDocumentBridge` — subscribes inside a registered iframe
 *    document (EPUB spine section, HTML doc): forwards selection + touch
 *    activity, forwards content scrolls, and exposes the iframe-offset
 *    transform + context builder (CFI) for capture time.
 *
 * Android workaround semantics are preserved verbatim: the adapters NEVER
 * call `removeAllRanges()` (touch selections survive dismissal), `touchend`
 * is treated as release-only (never re-arms the settle timer), and scroll
 * dismissal runs through `createScrollDismissGate` (in the hook).
 */

import type { Offset } from "./geometry";

/** Attribute marking the controller's own portaled UI (bar/sheet host). */
export const SELECTION_INTERACTION_UI_ATTR = "data-selection-interaction-ui";

export function isSelectionInteractionUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${SELECTION_INTERACTION_UI_ATTR}]`) !== null;
}

/** Selectors that identify reader content for event scoping. */
const CONTENT_SCOPERS = [
  "[data-document-content='true']",
  ".prose",
  ".textLayer",
  "[data-pdf-reflow-page]",
  "[data-transcript-scroll='true']",
  "[data-rss-content='true']",
];

export function isContentElement(target: EventTarget | null, extraRoots?: Set<Element>): boolean {
  if (!(target instanceof Element)) return false;
  if (extraRoots) {
    for (const root of extraRoots) {
      if (root === target || root.contains(target)) return true;
    }
  }
  return target.closest(CONTENT_SCOPERS.join(",")) !== null;
}

/**
 * True when a live selection is anchored in reader content (registered roots
 * or the standard content markers) — the readDocumentSelection scoping rule.
 */
export function isSelectionInContent(selection: Selection, extraRoots?: Set<Element>): boolean {
  for (const node of [selection.anchorNode, selection.focusNode]) {
    if (!node) continue;
    const element = node instanceof Element ? node : node.parentElement;
    if (element && isContentElement(element, extraRoots)) return true;
  }
  return false;
}

export interface SelectionAdapterHandlers {
  /** selectionchange fired in the adapted document. */
  onSelectionChanged: () => void;
  /** Content-area touch started (inContent is always true for iframes). */
  onContentTouchStart: (inContent: boolean) => void;
  /** touchend/touchcancel anywhere the adapter observes. */
  onContentTouchEnd: () => void;
  /** Mouse/pen release (desktop settle signal). */
  onPointerRelease: () => void;
  /**
   * Content scroll: (scroller identity, vertical, horizontal) offsets. The
   * controller runs its dismiss gate and revalidation on top of this.
   */
  onContentScroll: (target: EventTarget | null, top: number, left: number) => void;
  /** True when the event target belongs to controller-owned UI. */
  isOwnUi?: (target: EventTarget | null) => boolean;
}

export interface TopDocumentAdapterOptions {
  /** Extra content roots (e.g. a transcript scroll container). */
  contentRoots?: () => Set<Element>;
}

/**
 * Top-document adapter: the listener set the DocumentViewer stability effect
 * used, generalized into the controller's input stream. Returns detach.
 */
export function attachTopDocumentAdapter(
  handlers: SelectionAdapterHandlers,
  options: TopDocumentAdapterOptions = {},
): () => void {
  const ownUi = (target: EventTarget | null) =>
    handlers.isOwnUi?.(target) || isSelectionInteractionUi(target);

  const handleSelectionChange = () => handlers.onSelectionChanged();

  const handleTouchStart = (e: Event) => {
    if (ownUi(e.target)) return;
    handlers.onContentTouchStart(isContentElement(e.target, options.contentRoots?.()));
  };
  const handleTouchEnd = () => handlers.onContentTouchEnd();

  // Scroll events don't bubble, but they DO reach capture listeners on the
  // document — one listener covers every content scroller. Only scrollers
  // inside reader content count; overlays scroll their own trees.
  const handleScrollCapture = (e: Event) => {
    const target = e.target;
    if (target instanceof Element && isContentElement(target, options.contentRoots?.())) {
      handlers.onContentScroll(target, target.scrollTop, target.scrollLeft);
      return;
    }
    // window-level scroll (defaultView) reaches document with target=document
    if (target === document) {
      handlers.onContentScroll(window, window.scrollY, window.scrollX);
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (ownUi(e.target)) return;
    // Touch releases arrive through the touch listeners; mouse/pen release is
    // the desktop settle signal (current desktop timing preserved — no
    // artificial stability delay).
    if (e.pointerType === "mouse" || e.pointerType === "pen") handlers.onPointerRelease();
  };

  document.addEventListener("selectionchange", handleSelectionChange);
  document.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
  document.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
  document.addEventListener("touchcancel", handleTouchEnd, { capture: true, passive: true });
  document.addEventListener("scroll", handleScrollCapture, { capture: true, passive: true });
  document.addEventListener("pointerup", handlePointerUp);

  return () => {
    document.removeEventListener("selectionchange", handleSelectionChange);
    document.removeEventListener("touchstart", handleTouchStart, { capture: true } as EventListenerOptions);
    document.removeEventListener("touchend", handleTouchEnd, { capture: true } as EventListenerOptions);
    document.removeEventListener("touchcancel", handleTouchEnd, { capture: true } as EventListenerOptions);
    document.removeEventListener("scroll", handleScrollCapture, { capture: true } as EventListenerOptions);
    document.removeEventListener("pointerup", handlePointerUp);
  };
}

export interface ContentDocumentEntry {
  /** The iframe's content document (must be same-origin to read selections). */
  doc: Document;
  /** The iframe's content window, when reachable. */
  win?: Window | null;
  /** Iframe-local → app-viewport offset, read lazily at capture time. */
  offset?: () => Offset | null;
  /** Surface anchor builder (e.g. epub.js `contents.cfiFromRange`). */
  buildSelectionContext?: (range: Range, selection: Selection) => unknown;
}

/**
 * Iframe bridge: subscribes selection + touch + scroll inside a registered
 * content document (EPUB spine section / HTML iframe). Returns detach.
 */
export function attachContentDocumentBridge(
  entry: ContentDocumentEntry,
  handlers: SelectionAdapterHandlers,
): () => void {
  const { doc } = entry;
  const handleSelectionChange = () => handlers.onSelectionChanged();
  const handleTouchStart = (e: Event) => {
    if (isSelectionInteractionUi(e.target)) return;
    // Inside reader content by definition: a fresh gesture here clears the
    // dismissal guard (deliberate re-selection of suppressed text).
    handlers.onContentTouchStart(true);
  };
  const handleTouchEnd = () => handlers.onContentTouchEnd();
  const handleMouseUp = () => handlers.onPointerRelease();
  const handleScroll = (e: Event) => {
    const win = entry.win;
    if (win && e.target === win) {
      handlers.onContentScroll(win, win.scrollY, win.scrollX);
      return;
    }
    const target = e.target;
    if (target instanceof Element) {
      handlers.onContentScroll(target, target.scrollTop, target.scrollLeft);
    }
  };

  doc.addEventListener("selectionchange", handleSelectionChange);
  doc.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
  doc.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
  doc.addEventListener("touchcancel", handleTouchEnd, { capture: true, passive: true });
  doc.addEventListener("mouseup", handleMouseUp);
  if (entry.win) entry.win.addEventListener("scroll", handleScroll, { passive: true });
  doc.addEventListener("scroll", handleScroll, { capture: true, passive: true });

  return () => {
    doc.removeEventListener("selectionchange", handleSelectionChange);
    doc.removeEventListener("touchstart", handleTouchStart, { capture: true } as EventListenerOptions);
    doc.removeEventListener("touchend", handleTouchEnd, { capture: true } as EventListenerOptions);
    doc.removeEventListener("touchcancel", handleTouchEnd, { capture: true } as EventListenerOptions);
    doc.removeEventListener("mouseup", handleMouseUp);
    if (entry.win) entry.win.removeEventListener("scroll", handleScroll);
    doc.removeEventListener("scroll", handleScroll, { capture: true } as EventListenerOptions);
  };
}
