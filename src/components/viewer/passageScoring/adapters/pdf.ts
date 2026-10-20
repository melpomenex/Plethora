/**
 * Fixed-layout PDF passage adapter (task 3.1).
 *
 * Only mounted `.textLayer` roots are considered — virtualized/unrendered
 * pages and image-only (scanned) pages produce no candidates and never start
 * OCR. A passage is anchored by page number plus character offsets into the
 * mounted page text sequence and an exact quote. Normalized page rectangles
 * are projection data only; zoom/virtualization can change or drop them
 * without changing identity.
 */

import type { PassagePolicyIdentity } from "../types";
import {
  PASSAGE_MIN_TEXT_LENGTH,
  type PassageAdapter,
  type PassageEncounterEvent,
  type PassageLocator,
  type PassageNormalizedRect,
  type PassageProjectedRect,
  type PassageSnapshot,
} from "../types";
import { digestNormalizedPassage, normalizePassageText } from "../identity";

interface PdfLine {
  text: string;
  start: number;
  end: number;
  y: number;
  height: number;
  spans: Element[];
}

interface PdfBlockRecord {
  passageId: string;
  pageNumber: number;
  pageElement: Element;
  layer: Element;
  start: number;
  end: number;
  text: string;
  quote: string;
  lines: PdfLine[];
}

export interface PdfVisibilitySource {
  observe(element: Element, onEnter: () => void, onExit: () => void): void;
  disconnect(): void;
}

export function createPdfVisibility(doc: Document): PdfVisibilitySource {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  const Ctor =
    (view as unknown as { IntersectionObserver?: typeof IntersectionObserver } | null)
      ?.IntersectionObserver ??
    (typeof IntersectionObserver !== "undefined" ? IntersectionObserver : undefined);
  if (!Ctor) {
    return { observe() {}, disconnect() {} };
  }
  const handlers = new Map<Element, { enter: () => void; exit: () => void }>();
  const visible = new Set<Element>();
  const observer = new Ctor(
    (entries) => {
      for (const entry of entries) {
        const state = handlers.get(entry.target);
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
    { threshold: 0.1 }
  );
  return {
    observe(element, onEnter, onExit) {
      handlers.set(element, { enter: onEnter, exit: onExit });
      observer.observe(element);
    },
    disconnect() {
      handlers.clear();
      visible.clear();
      observer.disconnect();
    },
  };
}

export interface PdfPassageAdapterOptions {
  ownerToken: string;
  documentId: string;
  sourceRevision: string;
  /** Mounted text-layer roots; null holes are unmounted pages. */
  textLayers: Array<HTMLElement | null>;
  /** Optional explicit page numbers aligned with `textLayers`. */
  pageNumbers?: number[];
  visibilityFactory?: (doc: Document) => PdfVisibilitySource;
}

export class PdfPassageAdapter implements PassageAdapter {
  readonly ownerToken: string;
  private policy: PassagePolicyIdentity | null = null;
  private readonly listeners = new Set<(event: PassageEncounterEvent) => void>();
  private readonly records = new Map<string, PdfBlockRecord>();
  private readonly pageBlocks = new Map<Element, PdfBlockRecord[]>();
  private readonly visibility: PdfVisibilitySource | null = null;
  private readonly doc: Document | null;
  private disposed = false;
  private readonly documentId: string;
  private readonly sourceRevision: string;

  constructor(private readonly options: PdfPassageAdapterOptions) {
    this.ownerToken = options.ownerToken;
    this.documentId = options.documentId;
    this.sourceRevision = options.sourceRevision;
    const firstLayer = options.textLayers.find((root): root is HTMLElement => Boolean(root));
    this.doc = firstLayer?.ownerDocument ?? null;
    if (this.doc) {
      this.visibility =
        options.visibilityFactory?.(this.doc) ?? createPdfVisibility(this.doc);
      this.scan();
    }
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
    if (!this.visibility) return;
    this.options.textLayers.forEach((layer, index) => {
      if (!layer || !layer.isConnected) return;
      const pageElement =
        layer.closest("[data-pdf-page]") ?? layer.parentElement ?? layer;
      const dataPage = Number((pageElement as HTMLElement).dataset?.pageNumber);
      const pageNumber =
        this.options.pageNumbers?.[index] ??
        (Number.isFinite(dataPage) && dataPage > 0 ? dataPage : index + 1);
      let built = false;

      const enter = () => {
        if (this.disposed) return;
        if (!built) {
          const blocks = this.buildPageBlocks(layer, pageElement, pageNumber);
          built = true;
          if (blocks.length === 0) return;
          this.pageBlocks.set(pageElement, blocks);
          for (const block of blocks) {
            this.records.set(block.passageId, block);
            this.emit({ kind: "enter", passageId: block.passageId });
          }
          return;
        }
        const blocks = this.pageBlocks.get(pageElement);
        if (!blocks) return;
        for (const block of blocks) {
          this.emit({ kind: "enter", passageId: block.passageId });
        }
      };
      const exit = () => {
        const blocks = this.pageBlocks.get(pageElement);
        if (!blocks) return;
        for (const block of blocks) {
          this.emit({ kind: "exit", passageId: block.passageId });
        }
      };
      this.visibility!.observe(pageElement, enter, exit);
    });
  }

  private buildPageBlocks(
    layer: Element,
    pageElement: Element,
    pageNumber: number
  ): PdfBlockRecord[] {
    const spans = Array.from(layer.querySelectorAll("span")).filter(
      (span) => (span.textContent ?? "").trim().length > 0
    );
    if (spans.length === 0) return [];

    const layerRect = layer.getBoundingClientRect();
    const lines: PdfLine[] = [];
    let current: PdfLine | null = null;

    for (const span of spans) {
      const text = normalizePassageText(span.textContent ?? "");
      if (!text) continue;
      const rect = span.getBoundingClientRect();
      const styleTop = Number.parseFloat((span as HTMLElement).style?.top ?? "");
      const y = Number.isFinite(styleTop)
        ? styleTop
        : rect.top - layerRect.top;
      const height = rect.height > 0 ? rect.height : 12;
      const sameLine =
        current !== null && Math.abs(current.y - y) <= Math.max(4, height * 0.6);

      if (!current || !sameLine) {
        current = {
          text,
          start: 0,
          end: text.length,
          y,
          height,
          spans: [span],
        };
        lines.push(current);
      } else {
        const separator = current.text.endsWith(" ") || text.startsWith(" ") ? "" : " ";
        current.text = `${current.text}${separator}${text}`;
        current.end = current.text.length;
        current.spans.push(span);
        current.height = Math.max(current.height, height);
      }
    }

    // Assign page-text offsets: lines are joined with a newline.
    let cursor = 0;
    for (const line of lines) {
      line.start = cursor;
      line.end = cursor + line.text.length;
      cursor = line.end + 1; // newline
    }
    const pageText = lines.map((line) => line.text).join("\n");

    const blocks: PdfBlockRecord[] = [];
    let blockLines: PdfLine[] = [];
    const flush = () => {
      if (blockLines.length === 0) return;
      const start = blockLines[0].start;
      const end = blockLines[blockLines.length - 1].end;
      const text = pageText.slice(start, end);
      if (text.trim().length >= PASSAGE_MIN_TEXT_LENGTH) {
        const passageId = `pdf:${pageNumber}:${start}-${end}`;
        blocks.push({
          passageId,
          pageNumber,
          pageElement,
          layer,
          start,
          end,
          text,
          quote: text,
          lines: [...blockLines],
        });
      }
      blockLines = [];
    };
    const charLength = () =>
      blockLines.reduce((sum, line) => sum + line.text.length + 1, 0);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const previous = blockLines[blockLines.length - 1];
      const verticalGap = previous ? line.y - (previous.y + previous.height) : 0;
      const paragraphBreak = previous ? verticalGap > Math.max(8, previous.height * 0.8) : false;
      if (paragraphBreak && charLength() >= PASSAGE_MIN_TEXT_LENGTH * 2) {
        flush();
      }
      blockLines.push(line);
      if (charLength() >= 1_200) flush();
    }
    flush();
    return blocks;
  }

  snapshot(passageId: string): PassageSnapshot | null {
    if (this.disposed || !this.policy) return null;
    const record = this.records.get(passageId);
    if (!record || !record.pageElement.isConnected || !record.layer.isConnected) return null;
    const rects = this.normalizedRects(record);
    return {
      ownerToken: this.ownerToken,
      documentId: this.documentId,
      sourceRevision: this.sourceRevision,
      passageId,
      contentHash: digestNormalizedPassage(record.text, this.policy),
      locator: {
        kind: "pdf",
        sourceType: "pdf",
        documentId: this.documentId,
        pageNumber: record.pageNumber,
        startOffset: record.start,
        endOffset: record.end,
        quote: record.quote,
        rects,
      },
      text: record.text,
    };
  }

  private normalizedRects(record: PdfBlockRecord): PassageNormalizedRect[] {
    const base = record.pageElement.getBoundingClientRect();
    if (base.width <= 0 || base.height <= 0) return [];
    const rects: PassageNormalizedRect[] = [];
    for (const line of record.lines) {
      for (const span of line.spans) {
        for (const rect of Array.from(span.getClientRects())) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          rects.push({
            x: clamp01((rect.left - base.left) / base.width),
            y: clamp01((rect.top - base.top) / base.height),
            width: clamp01(rect.width / base.width),
            height: clamp01(rect.height / base.height),
          });
          if (rects.length >= 80) return rects;
        }
      }
    }
    return rects;
  }

  projectRects(passageId: string): PassageProjectedRect[] | null {
    if (this.disposed) return null;
    const record = this.records.get(passageId);
    if (!record || !record.pageElement.isConnected) return null;
    const base = record.pageElement.getBoundingClientRect();
    if (base.width <= 0 || base.height <= 0) return null;
    const rects: PassageProjectedRect[] = [];
    for (const line of record.lines) {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = 0;
      let maxY = 0;
      for (const span of line.spans) {
        const rect = span.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        minX = Math.min(minX, rect.left);
        minY = Math.min(minY, rect.top);
        maxX = Math.max(maxX, rect.right);
        maxY = Math.max(maxY, rect.bottom);
      }
      if (!Number.isFinite(minX)) continue;
      rects.push({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
      if (rects.length >= 40) break;
    }
    return rects.length > 0 ? rects : null;
  }

  resolveLocator(locator: PassageLocator): boolean {
    if (locator.kind !== "pdf") return false;
    for (const record of this.records.values()) {
      if (
        record.pageNumber === locator.pageNumber &&
        record.start === locator.startOffset &&
        record.end === locator.endOffset
      ) {
        try {
          record.pageElement.scrollIntoView({ block: "center", behavior: "smooth" });
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.visibility?.disconnect();
    this.records.clear();
    this.pageBlocks.clear();
    this.listeners.clear();
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
