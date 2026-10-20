/**
 * DOM block passage adapter for rendered HTML / Markdown / plain text / RSS
 * (tasks 3.3/3.4).
 *
 * Enumerates block elements structurally (never a document-wide `innerText`
 * scan), observes only mounted blocks for visibility, and reads a block's text
 * when it becomes a candidate. Anchors are content-derived: a source offset
 * when the source text is available, otherwise a quote digest plus occurrence.
 * A generated DOM child index is never used as identity.
 */

import type { PassagePolicyIdentity } from "../types";
import {
  PASSAGE_MIN_TEXT_LENGTH,
  type PassageAdapter,
  type PassageEncounterEvent,
  type PassageLocator,
  type PassageProjectedRect,
  type PassageSnapshot,
} from "../types";
import { digestNormalizedPassage, normalizePassageText, splitPassageText } from "../identity";
import { sha256Short } from "../hash";

export const PASSAGE_BLOCK_SELECTOR = [
  "p",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "td",
  "th",
  "dd",
  "dt",
  "figcaption",
  "[data-pdf-reflow-block]",
].join(",");

export const PASSAGE_LEAF_DIV_SELECTOR = "div,section,article";

export const PASSAGE_EXCLUDED_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "a",
  "[role='button']",
  "[role='link']",
  "[role='navigation']",
  "[aria-hidden='true']",
  "[hidden]",
  "[style*='display: none']",
  "[style*='display:none']",
  "[style*='visibility: hidden']",
  "[style*='visibility:hidden']",
  ".no-select",
  "[data-selection-interaction-ui]",
  "[data-passage-scoring-ui]",
].join(",");

export interface DomBlockRoot {
  doc: Document;
  root: Element;
  /** Iframe-local → app-viewport offset, read at projection time. */
  offset?: () => { x: number; y: number } | null;
}

export interface DomVisibilitySource {
  observe(
    element: Element,
    onEnter: () => void,
    onExit: () => void
  ): void;
  unobserve(element: Element): void;
  disconnect(): void;
}

function createIntersectionVisibility(doc: Document): DomVisibilitySource {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Ctor =
    (view as unknown as { IntersectionObserver?: typeof IntersectionObserver } | null)
      ?.IntersectionObserver ??
    (typeof IntersectionObserver !== "undefined" ? IntersectionObserver : undefined);

  if (Ctor) {
    const callbacks = new Map<Element, { onEnter: () => void; onExit: () => void }>();
    const visible = new Set<Element>();
    const observer = new Ctor(
      (entries) => {
        for (const entry of entries) {
          const handlers = callbacks.get(entry.target);
          if (!handlers) continue;
          if (entry.isIntersecting && !visible.has(entry.target)) {
            visible.add(entry.target);
            handlers.onEnter();
          } else if (!entry.isIntersecting && visible.has(entry.target)) {
            visible.delete(entry.target);
            handlers.onExit();
          }
        }
      },
      { threshold: 0.25 }
    );
    return {
      observe(element, onEnter, onExit) {
        callbacks.set(element, { onEnter, onExit });
        observer.observe(element);
      },
      unobserve(element) {
        callbacks.delete(element);
        visible.delete(element);
        observer.unobserve(element);
      },
      disconnect() {
        callbacks.clear();
        visible.clear();
        observer.disconnect();
      },
    };
  }

  // Fallback for environments without IntersectionObserver (older WebViews):
  // a bounded visibility sample on a timer, never inference on scroll.
  const entries = new Map<Element, { onEnter: () => void; onExit: () => void; visible: boolean }>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const sample = () => {
    for (const [element, handlers] of entries) {
      const rect = element.getBoundingClientRect();
      const isVisible = rect.bottom > 0 && rect.top < (doc.defaultView?.innerHeight ?? 0) && rect.height > 0;
      if (isVisible && !handlers.visible) {
        handlers.visible = true;
        handlers.onEnter();
      } else if (!isVisible && handlers.visible) {
        handlers.visible = false;
        handlers.onExit();
      }
    }
  };
  return {
    observe(element, onEnter, onExit) {
      entries.set(element, { onEnter, onExit, visible: false });
      if (timer === null) timer = setInterval(sample, 500);
    },
    unobserve(element) {
      entries.delete(element);
      if (entries.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    disconnect() {
      entries.clear();
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

interface PartRecord {
  passageId: string;
  text: string;
  locator: PassageLocator;
  element: Element;
  root: DomBlockRoot;
}

export interface DomBlockAdapterOptions {
  ownerToken: string;
  sourceRevision: string;
  kind: "html" | "markdown" | "text" | "rss";
  documentId?: string;
  roots: DomBlockRoot[];
  /** Source text used for stable source offsets (Markdown/HTML content). */
  sourceText?: () => string | null;
  /** RSS identity when the article is not a library document. */
  articleId?: string;
  articleRevision?: string;
  observerFactory?: (root: DomBlockRoot) => DomVisibilitySource;
}

export class DomBlockPassageAdapter implements PassageAdapter {
  readonly ownerToken: string;
  private policy: PassagePolicyIdentity | null = null;
  private readonly listenerSet = new Set<(event: PassageEncounterEvent) => void>();
  private readonly records = new Map<string, PartRecord>();
  private readonly partsByElement = new Map<Element, PartRecord[]>();
  private readonly visibility: DomVisibilitySource[] = [];
  private disposed = false;
  private readonly sourceRevision: string;
  private readonly kind: DomBlockAdapterOptions["kind"];
  private readonly documentId?: string;
  private readonly articleId?: string;
  private readonly articleRevision?: string;
  private readonly sourceText?: () => string | null;

  constructor(private readonly options: DomBlockAdapterOptions) {
    this.ownerToken = options.ownerToken;
    this.sourceRevision = options.sourceRevision;
    this.kind = options.kind;
    this.documentId = options.documentId;
    this.articleId = options.articleId;
    this.articleRevision = options.articleRevision;
    this.sourceText = options.sourceText;
    this.scan();
  }

  configure(policy: PassagePolicyIdentity): void {
    this.policy = policy;
  }

  subscribeEncountered(listener: (event: PassageEncounterEvent) => void): () => void {
    this.listenerSet.add(listener);
    return () => this.listenerSet.delete(listener);
  }

  private emit(event: PassageEncounterEvent): void {
    for (const listener of this.listenerSet) listener(event);
  }

  private scan(): void {
    if (this.disposed) return;
    const occurrenceByQuote = new Map<string, number>();
    const occurrenceBySource = new Map<number, number>();
    for (const root of this.options.roots) {
      if (!root.root.isConnected) continue;
      const visibility =
        this.options.observerFactory?.(root) ?? createIntersectionVisibility(root.doc);
      this.visibility.push(visibility);

      for (const element of this.collectBlocks(root.root)) {
        const register = () => {
          const parts = this.buildParts(element, root, occurrenceByQuote, occurrenceBySource);
          if (parts.length === 0) return;
          this.partsByElement.set(element, parts);
          for (const part of parts) {
            this.records.set(part.passageId, part);
            this.emit({ kind: "enter", passageId: part.passageId });
          }
        };
        const unregister = () => {
          const parts = this.partsByElement.get(element);
          if (!parts) return;
          this.partsByElement.delete(element);
          for (const part of parts) {
            this.records.delete(part.passageId);
            this.emit({ kind: "exit", passageId: part.passageId });
          }
        };
        visibility.observe(element, register, unregister);
      }
    }
  }

  private collectBlocks(root: Element): Element[] {
    const blocks: Element[] = [];
    const candidates = root.querySelectorAll(PASSAGE_BLOCK_SELECTOR);
    for (const element of Array.from(candidates)) {
      if (element.closest(PASSAGE_EXCLUDED_SELECTOR)) continue;
      // Only the outermost matching block in this root, so nested <p> inside
      // <blockquote> is not scored twice.
      const outer = element.parentElement?.closest(PASSAGE_BLOCK_SELECTOR);
      if (outer && root.contains(outer)) continue;
      blocks.push(element);
    }
    // RSS/article bodies often use leaf <div> wrappers rather than <p>.
    for (const element of Array.from(root.querySelectorAll(PASSAGE_LEAF_DIV_SELECTOR))) {
      if (element === root) continue;
      if (element.closest(PASSAGE_EXCLUDED_SELECTOR)) continue;
      if (element.querySelector(PASSAGE_BLOCK_SELECTOR) || element.querySelector(PASSAGE_LEAF_DIV_SELECTOR)) {
        continue;
      }
      // Structure only: text is read when this block is actually encountered.
      blocks.push(element);
    }
    return blocks;
  }

  private buildParts(
    element: Element,
    root: DomBlockRoot,
    occurrenceByQuote: Map<string, number>,
    occurrenceBySource: Map<number, number>
  ): PartRecord[] {
    const view = element.ownerDocument.defaultView;
    const computed = view?.getComputedStyle?.(element);
    if (computed && (computed.display === "none" || computed.visibility === "hidden")) {
      return [];
    }
    const raw = element.textContent ?? "";
    const normalized = normalizePassageText(raw);
    if (normalized.length < PASSAGE_MIN_TEXT_LENGTH) return [];
    const parts = splitPassageText(normalized);
    const source = this.sourceText?.() ?? null;
    const sourceIndex = source ? findSourceOffset(source, parts[0]?.text ?? normalized) : -1;
    let baseAnchor: string;
    if (sourceIndex >= 0) {
      const occurrence = occurrenceBySource.get(sourceIndex) ?? 0;
      occurrenceBySource.set(sourceIndex, occurrence + 1);
      // Identical text can map to the same source offset (e.g. a duplicated
      // quote). The occurrence suffix keeps the anchors distinct without
      // falling back to a DOM child index.
      baseAnchor = occurrence === 0 ? `src:${sourceIndex}` : `src:${sourceIndex}:${occurrence}`;
    } else {
      const quoteHash = sha256Short(normalized, 12);
      const occurrence = occurrenceByQuote.get(quoteHash) ?? 0;
      occurrenceByQuote.set(quoteHash, occurrence + 1);
      baseAnchor = `txt:${quoteHash}:${occurrence}`;
    }

    return parts.map((part) => {
      const passageId = `${this.kind}:${baseAnchor}:${part.start}-${part.end}`;
      const locator = this.buildLocator(baseAnchor, part.start, part.end, part.text, element, root);
      return { passageId, text: part.text, locator, element, root };
    });
  }

  private buildLocator(
    anchorId: string,
    start: number,
    end: number,
    quote: string,
    _element: Element,
    _root: DomBlockRoot
  ): PassageLocator {
    if (this.kind === "rss") {
      return {
        kind: "rss",
        sourceType: "html",
        documentId: this.documentId,
        articleId: this.articleId ?? this.ownerToken,
        articleRevision: this.articleRevision ?? this.sourceRevision,
        anchorId,
        startOffset: start,
        endOffset: end,
        quote,
      };
    }
    const sourceType = this.kind === "markdown" ? "markdown" : this.kind === "text" ? "text" : "html";
    return {
      kind: sourceType,
      sourceType,
      documentId: this.documentId ?? "",
      anchorId,
      startOffset: start,
      endOffset: end,
      quote,
    };
  }

  snapshot(passageId: string): PassageSnapshot | null {
    if (this.disposed) return null;
    const record = this.records.get(passageId);
    if (!record || !record.element.isConnected) return null;
    const policy = this.policy;
    if (!policy) return null;
    return {
      ownerToken: this.ownerToken,
      documentId: this.documentId,
      sourceRevision: this.sourceRevision,
      passageId,
      contentHash: digestNormalizedPassage(normalizePassageText(record.text), policy),
      locator: record.locator,
      text: record.text,
    };
  }

  projectRects(passageId: string): PassageProjectedRect[] | null {
    if (this.disposed) return null;
    const record = this.records.get(passageId);
    if (!record || !record.element.isConnected) return null;
    const offset = record.root.offset?.() ?? { x: 0, y: 0 };
    const rects: PassageProjectedRect[] = [];
    for (const rect of Array.from(record.element.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      rects.push({
        x: rect.left + offset.x,
        y: rect.top + offset.y,
        width: rect.width,
        height: rect.height,
      });
    }
    return rects.length > 0 ? rects : null;
  }

  resolveLocator(locator: PassageLocator): boolean {
    if (this.disposed) return false;
    for (const record of this.records.values()) {
      if (record.locator.kind !== locator.kind) continue;
      const sameAnchor =
        "anchorId" in locator && "anchorId" in record.locator
          ? locator.anchorId === record.locator.anchorId
          : true;
      const sameOffsets =
        "startOffset" in locator && "startOffset" in record.locator
          ? record.locator.startOffset === locator.startOffset &&
            record.locator.endOffset === locator.endOffset
          : true;
      if (!sameAnchor || !sameOffsets) continue;
      try {
        record.element.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const visibility of this.visibility) visibility.disconnect();
    this.visibility.length = 0;
    this.records.clear();
    this.partsByElement.clear();
    this.listenerSet.clear();
  }
}

function findSourceOffset(source: string, quote: string): number {
  if (!source || !quote) return -1;
  const probe = quote.slice(0, Math.min(64, quote.length));
  const index = source.indexOf(probe);
  return index >= 0 ? index : -1;
}
