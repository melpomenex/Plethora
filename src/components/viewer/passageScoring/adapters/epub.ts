/**
 * EPUB passage adapter over registered rendition content documents (task 3.2).
 *
 * The rendition owns spine iframes; the host registers/unregisters each
 * content document (the same registration used by selection interaction).
 * Passage identity is spine + CFI range + split offsets. If no CFI can be
 * produced for a block, the passage is not offered — a misplaced margin mark
 * is worse than manual selection actions only.
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
import {
  PASSAGE_BLOCK_SELECTOR,
  PASSAGE_EXCLUDED_SELECTOR,
  type DomVisibilitySource,
} from "./domBlocks";

export interface PassageContentDocumentEntry {
  doc: Document;
  win?: Window | null;
  /** Iframe-local → app viewport offset, read lazily. */
  offset?: () => { x: number; y: number } | null;
  /** Surface CFI builder (epub.js `contents.cfiFromRange`). */
  buildSelectionContext?: (range: Range, selection: Selection | null) => unknown;
  spineIndex?: number;
  spineHref?: string;
}

interface EpubPartRecord {
  passageId: string;
  text: string;
  quote: string;
  cfiRange: string;
  spineIndex: number;
  spineHref?: string;
  start: number;
  end: number;
  element: Element;
  entry: PassageContentDocumentEntry;
}

export interface EpubPassageAdapterOptions {
  ownerToken: string;
  documentId: string;
  sourceRevision: string;
  entries: PassageContentDocumentEntry[];
  visibilityFactory?: (doc: Document) => DomVisibilitySource;
}

export class EpubPassageAdapter implements PassageAdapter {
  readonly ownerToken: string;
  private policy: PassagePolicyIdentity | null = null;
  private readonly listeners = new Set<(event: PassageEncounterEvent) => void>();
  private readonly records = new Map<string, EpubPartRecord>();
  private readonly elementParts = new Map<Element, EpubPartRecord[]>();
  private readonly visibility: DomVisibilitySource[] = [];
  private readonly unloadDetachers: Array<() => void> = [];
  private disposed = false;
  private readonly documentId: string;
  private readonly sourceRevision: string;
  private readonly entries: PassageContentDocumentEntry[];

  constructor(private readonly options: EpubPassageAdapterOptions) {
    this.ownerToken = options.ownerToken;
    this.documentId = options.documentId;
    this.sourceRevision = options.sourceRevision;
    this.entries = options.entries;
    this.scan();
  }

  configure(policy: PassagePolicyIdentity): void {
    this.policy = policy;
  }

  subscribeEncountered(listener: (event: PassageEncounterEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PassageEncounterEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private scan(): void {
    for (const entry of this.entries) {
      if (this.disposed) return;
      const body = entry.doc?.body;
      if (!body) continue;
      const datasetSpine = Number((body as HTMLElement).dataset?.epubSpineIndex);
      const spineIndex =
        entry.spineIndex ??
        (Number.isFinite(datasetSpine) ? datasetSpine : -1);
      const spineHref =
        entry.spineHref ?? (body as HTMLElement).dataset?.epubHref ?? undefined;
      const visibility =
        this.options.visibilityFactory?.(entry.doc) ?? createEpubVisibility(entry.doc);
      this.visibility.push(visibility);

      const blocks = new Set<Element>();
      for (const element of Array.from(body.querySelectorAll(PASSAGE_BLOCK_SELECTOR))) {
        if (element.closest(PASSAGE_EXCLUDED_SELECTOR)) continue;
        const outer = element.parentElement?.closest(PASSAGE_BLOCK_SELECTOR);
        if (outer && body.contains(outer)) continue;
        // Structure only: text is read when the block is encountered.
        blocks.add(element);
      }

      for (const element of blocks) {
        const register = () => {
          const parts = this.buildParts(element, entry, spineIndex, spineHref);
          if (parts.length === 0) return;
          this.elementParts.set(element, parts);
          for (const part of parts) {
            this.records.set(part.passageId, part);
            this.emit({ kind: "enter", passageId: part.passageId });
          }
        };
        const unregister = () => {
          const parts = this.elementParts.get(element);
          if (!parts) return;
          this.elementParts.delete(element);
          for (const part of parts) {
            this.records.delete(part.passageId);
            this.emit({ kind: "exit", passageId: part.passageId });
          }
        };
        visibility.observe(element, register, unregister);
      }

      // Iframe removal/navigation: drop geometry and subscriptions for it.
      const win = entry.win;
      if (win) {
        const onUnload = () => this.dropEntry(entry);
        win.addEventListener("unload", onUnload);
        this.unloadDetachers.push(() => win.removeEventListener("unload", onUnload));
      }
    }
  }

  private dropEntry(entry: PassageContentDocumentEntry): void {
    for (const [element, parts] of this.elementParts) {
      if (element.ownerDocument !== entry.doc) continue;
      this.elementParts.delete(element);
      for (const part of parts) {
        this.records.delete(part.passageId);
        this.emit({ kind: "exit", passageId: part.passageId });
      }
    }
  }

  private buildParts(
    element: Element,
    entry: PassageContentDocumentEntry,
    spineIndex: number,
    spineHref?: string
  ): EpubPartRecord[] {
    const normalized = normalizePassageText(element.textContent ?? "");
    if (normalized.length < PASSAGE_MIN_TEXT_LENGTH) return [];
    if (!entry.buildSelectionContext) return [];
    let cfiRange = "";
    try {
      const range = entry.doc.createRange();
      range.selectNodeContents(element);
      const context = entry.buildSelectionContext(
        range,
        entry.doc.getSelection() as Selection
      );
      if (context && typeof context === "object" && "cfiRange" in context) {
        const candidate = (context as { cfiRange?: unknown }).cfiRange;
        if (typeof candidate === "string" && candidate.length > 0) cfiRange = candidate;
      }
    } catch {
      return [];
    }
    if (!cfiRange) return [];

    const anchor = `cfi:${sha256Short(cfiRange, 16)}:${spineIndex}`;
    return splitPassageText(normalized).map((part) => ({
      passageId: `epub:${spineIndex}:${anchor}:${part.start}-${part.end}`,
      text: part.text,
      quote: part.text,
      cfiRange,
      spineIndex,
      spineHref,
      start: part.start,
      end: part.end,
      element,
      entry,
    }));
  }

  snapshot(passageId: string): PassageSnapshot | null {
    if (this.disposed || !this.policy) return null;
    const record = this.records.get(passageId);
    if (!record || !record.element.isConnected) return null;
    return {
      ownerToken: this.ownerToken,
      documentId: this.documentId,
      sourceRevision: this.sourceRevision,
      passageId,
      contentHash: digestNormalizedPassage(record.text, this.policy),
      locator: this.locatorFor(record),
      text: record.text,
    };
  }

  private locatorFor(record: EpubPartRecord): PassageLocator {
    return {
      kind: "epub",
      sourceType: "epub",
      documentId: this.documentId,
      spineIndex: record.spineIndex,
      spineHref: record.spineHref,
      cfiRange: record.cfiRange,
      quote: record.quote,
    };
  }

  projectRects(passageId: string): PassageProjectedRect[] | null {
    if (this.disposed) return null;
    const record = this.records.get(passageId);
    if (!record || !record.element.isConnected) return null;
    const offset = record.entry.offset?.() ?? { x: 0, y: 0 };
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
    if (locator.kind !== "epub") return false;
    for (const record of this.records.values()) {
      if (record.cfiRange !== locator.cfiRange) continue;
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
    for (const detach of this.unloadDetachers) {
      try {
        detach();
      } catch {
        /* ignore */
      }
    }
    this.unloadDetachers.length = 0;
    this.records.clear();
    this.elementParts.clear();
    this.listeners.clear();
  }
}

/** IntersectionObserver within an iframe document (root = iframe viewport). */
function createEpubVisibility(doc: Document): DomVisibilitySource {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Ctor =
    (view as unknown as { IntersectionObserver?: typeof IntersectionObserver } | null)
      ?.IntersectionObserver ??
    (typeof IntersectionObserver !== "undefined" ? IntersectionObserver : undefined);
  if (!Ctor) {
    return {
      observe() {},
      unobserve() {},
      disconnect() {},
    };
  }
  const callbacks = new Map<Element, { enter: () => void; exit: () => void }>();
  const visible = new Set<Element>();
  const observer = new Ctor(
    (entries) => {
      for (const entry of entries) {
        const state = callbacks.get(entry.target);
        if (!state) continue;
        if (entry.isIntersecting && !visible.has(entry.target)) {
          visible.add(entry.target);
          state.enter();
        } else if (!entry.isIntersecting && visible.has(entry.target)) {
          visible.delete(entry.target);
          state.exit();
        }
      }
    },
    { threshold: 0.25 }
  );
  return {
    observe(element, onEnter, onExit) {
      callbacks.set(element, { enter: onEnter, exit: onExit });
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
