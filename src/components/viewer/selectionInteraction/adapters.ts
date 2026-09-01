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

function isElement(target: EventTarget | null): target is Element {
  return Boolean(
    target &&
      typeof target === "object" &&
      "nodeType" in target &&
      (target as Node).nodeType === 1 &&
      typeof (target as Element).closest === "function",
  );
}

/** Attribute marking the controller's own portaled UI (bar/sheet host). */
export const SELECTION_INTERACTION_UI_ATTR = "data-selection-interaction-ui";

export function isSelectionInteractionUi(target: EventTarget | null): boolean {
  return isElement(target) && target.closest(`[${SELECTION_INTERACTION_UI_ATTR}]`) !== null;
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
  if (!isElement(target)) return false;
  if (extraRoots) {
    for (const root of extraRoots) {
      if (root === target || root.contains(target)) return true;
    }
  }
  // Inside a content iframe, document !== window.document; the entire iframe body is reader content
  if (target.ownerDocument && typeof document !== "undefined" && target.ownerDocument !== document) {
    return true;
  }
  return target.closest(CONTENT_SCOPERS.join(",")) !== null;
}

/** Interactive element selectors that should NOT trigger automatic paragraph selection. */
export const INTERACTIVE_SELECTORS = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[data-selection-interaction-ui]",
  ".no-select",
];

export function isInteractiveElement(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  return target.closest(INTERACTIVE_SELECTORS.join(",")) !== null;
}

/** Selectors identifying block-level paragraph content units. */
export const PARAGRAPH_SELECTORS = [
  "p",
  "blockquote",
  "[data-pdf-reflow-block]",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

/**
 * Resolves the closest enclosing paragraph element from a touch/click target,
 * excluding interactive controls and non-content areas.
 */
export function findParagraphElement(
  target: EventTarget | null,
  extraRoots?: Set<Element>,
): HTMLElement | null {
  if (!isElement(target)) return null;
  if (isInteractiveElement(target)) return null;
  if (!isContentElement(target, extraRoots)) return null;

  const el = target.closest<HTMLElement>(PARAGRAPH_SELECTORS.join(","));
  if (!el) return null;
  if (!el.textContent?.trim()) return null;
  return el;
}

/**
 * Programmatically creates a DOM Range covering the entire text contents of a
 * paragraph element and sets it as the active Selection in that document.
 */
export function selectParagraphElement(
  paragraph: HTMLElement,
  targetDoc: Document = document,
): boolean {
  const win = targetDoc.defaultView || (typeof window !== "undefined" ? window : null);
  const selection =
    win?.getSelection?.() ||
    (typeof (targetDoc as unknown as { getSelection?: () => Selection }).getSelection === "function"
      ? (targetDoc as unknown as { getSelection: () => Selection }).getSelection()
      : null) ||
    (typeof window !== "undefined" ? window.getSelection?.() : null);
  if (!selection) return false;

  try {
    const range = targetDoc.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

export const DOUBLE_TAP_MAX_DELAY_MS = 350;
export const DOUBLE_TAP_MAX_DISTANCE_PX = 30;

interface TouchPoint {
  time: number;
  x: number;
  y: number;
  target: EventTarget | null;
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
  /**
   * Double-click in reader content (not on controller UI): flags the next
   * settle's gesture origin as "double-click" — the only desktop gesture that
   * auto-opens the dictionary peek (design D3).
   */
  onDoubleClick?: () => void;
  /**
   * Double-tap on a paragraph in reader content: flags the next settle's
   * gesture origin as "double-tap" and triggers immediate UI activation.
   */
  onDoubleTap?: (
    paragraphElement: HTMLElement,
    origin?: "double-tap" | "double-click",
  ) => void;
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

  let lastTouchPoint: TouchPoint | null = null;

  const handleSelectionChange = () => handlers.onSelectionChanged();

  const handleTouchStart = (e: Event) => {
    if (ownUi(e.target)) return;
    const inContent = isContentElement(e.target, options.contentRoots?.());

    if (inContent && "touches" in e) {
      const touchEvent = e as TouchEvent;
      const touch = touchEvent.touches?.[0];
      if (touch) {
        const now = Date.now();
        const prev = lastTouchPoint;
        if (
          prev &&
          now - prev.time <= DOUBLE_TAP_MAX_DELAY_MS &&
          Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) <= DOUBLE_TAP_MAX_DISTANCE_PX
        ) {
          const paragraph = findParagraphElement(e.target, options.contentRoots?.());
          if (paragraph) {
            if (e.cancelable) e.preventDefault();
            const selected = selectParagraphElement(paragraph, document);
            if (selected) {
              lastTouchPoint = null;
              handlers.onContentTouchStart(inContent);
              handlers.onSelectionChanged();
              handlers.onDoubleTap?.(paragraph, "double-tap");
              return;
            }
          }
        }
        lastTouchPoint = {
          time: now,
          x: touch.clientX,
          y: touch.clientY,
          target: e.target,
        };
      }
    } else {
      lastTouchPoint = null;
    }

    handlers.onContentTouchStart(inContent);
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

  const handleDblClick = (e: Event) => {
    if (ownUi(e.target)) return;
    const paragraph = findParagraphElement(e.target, options.contentRoots?.());
    if (paragraph) {
      const selected = selectParagraphElement(paragraph, document);
      if (selected) {
        handlers.onSelectionChanged();
        handlers.onDoubleTap?.(paragraph, "double-click");
      }
    }
    handlers.onDoubleClick?.();
  };

  document.addEventListener("selectionchange", handleSelectionChange);
  // passive:false so preventDefault can suppress native double-tap word selection.
  document.addEventListener("touchstart", handleTouchStart, { capture: true, passive: false });
  document.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
  document.addEventListener("touchcancel", handleTouchEnd, { capture: true, passive: true });
  document.addEventListener("scroll", handleScrollCapture, { capture: true, passive: true });
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("dblclick", handleDblClick);

  return () => {
    document.removeEventListener("selectionchange", handleSelectionChange);
    document.removeEventListener("touchstart", handleTouchStart, { capture: true } as EventListenerOptions);
    document.removeEventListener("touchend", handleTouchEnd, { capture: true } as EventListenerOptions);
    document.removeEventListener("touchcancel", handleTouchEnd, { capture: true } as EventListenerOptions);
    document.removeEventListener("scroll", handleScrollCapture, { capture: true } as EventListenerOptions);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("dblclick", handleDblClick);
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
  let lastBridgeTouchPoint: TouchPoint | null = null;

  const handleSelectionChange = () => handlers.onSelectionChanged();
  const handleTouchStart = (e: Event) => {
    if (isSelectionInteractionUi(e.target)) return;

    if ("touches" in e) {
      const touchEvent = e as TouchEvent;
      const touch = touchEvent.touches?.[0];
      if (touch) {
        const now = Date.now();
        const prev = lastBridgeTouchPoint;
        if (
          prev &&
          now - prev.time <= DOUBLE_TAP_MAX_DELAY_MS &&
          Math.hypot(touch.clientX - prev.x, touch.clientY - prev.y) <= DOUBLE_TAP_MAX_DISTANCE_PX
        ) {
          const paragraph = findParagraphElement(e.target);
          if (paragraph) {
            if (e.cancelable) e.preventDefault();
            const selected = selectParagraphElement(paragraph, doc);
            if (selected) {
              lastBridgeTouchPoint = null;
              handlers.onContentTouchStart(true);
              handlers.onSelectionChanged();
              handlers.onDoubleTap?.(paragraph, "double-tap");
              return;
            }
          }
        }
        lastBridgeTouchPoint = {
          time: now,
          x: touch.clientX,
          y: touch.clientY,
          target: e.target,
        };
      }
    } else {
      lastBridgeTouchPoint = null;
    }

    // Inside reader content by definition: a fresh gesture here clears the
    // dismissal guard (deliberate re-selection of suppressed text).
    handlers.onContentTouchStart(true);
  };
  const handleTouchEnd = () => handlers.onContentTouchEnd();
  const handleMouseUp = () => handlers.onPointerRelease();
  const handleDblClick = (e: Event) => {
    if (isSelectionInteractionUi(e.target)) return;
    const paragraph = findParagraphElement(e.target);
    if (paragraph) {
      const selected = selectParagraphElement(paragraph, doc);
      if (selected) {
        handlers.onSelectionChanged();
        handlers.onDoubleTap?.(paragraph, "double-click");
      }
    }
    handlers.onDoubleClick?.();
  };
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
  doc.addEventListener("touchstart", handleTouchStart, { capture: true, passive: false });
  doc.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
  doc.addEventListener("touchcancel", handleTouchEnd, { capture: true, passive: true });
  doc.addEventListener("mouseup", handleMouseUp);
  doc.addEventListener("dblclick", handleDblClick);
  if (entry.win) entry.win.addEventListener("scroll", handleScroll, { passive: true });
  doc.addEventListener("scroll", handleScroll, { capture: true, passive: true });

  return () => {
    doc.removeEventListener("selectionchange", handleSelectionChange);
    doc.removeEventListener("touchstart", handleTouchStart, { capture: true } as EventListenerOptions);
    doc.removeEventListener("touchend", handleTouchEnd, { capture: true } as EventListenerOptions);
    doc.removeEventListener("touchcancel", handleTouchEnd, { capture: true } as EventListenerOptions);
    doc.removeEventListener("mouseup", handleMouseUp);
    doc.removeEventListener("dblclick", handleDblClick);
    if (entry.win) entry.win.removeEventListener("scroll", handleScroll);
    doc.removeEventListener("scroll", handleScroll, { capture: true } as EventListenerOptions);
  };
}

