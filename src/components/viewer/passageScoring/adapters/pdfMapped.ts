/**
 * Mapped PDF block adapter for reflow and OCR-HTML page hosts (task 3.3).
 *
 * Reflow and OCR pages keep their canonical page sections in the reader DOM
 * (`[data-pdf-reflow-page]`, `.ocr-page[data-ocr-page-number]`). A passage is
 * anchored by page number plus offsets into the canonical page text that the
 * host already produced. If the rendered block cannot be located in that page
 * text, the passage is skipped: manual selection actions remain, but a
 * misplaced margin mark cannot appear.
 */

import {
  PASSAGE_MIN_TEXT_LENGTH,
  type PassageAdapter,
  type PassageEncounterEvent,
  type PassageLocator,
  type PassageNormalizedRect,
  type PassagePolicyIdentity,
  type PassageProjectedRect,
  type PassageSnapshot,
} from "../types";
import { digestNormalizedPassage, normalizePassageText, splitPassageText } from "../identity";
import { PASSAGE_BLOCK_SELECTOR, PASSAGE_EXCLUDED_SELECTOR } from "./domBlocks";
import { createPdfVisibility, type PdfVisibilitySource } from "./pdf";

interface MappedRecord {
  passageId: string;
  pageNumber: number;
  start: number;
  end: number;
  text: string;
  element: Element;
  pageElement: Element;
}

export interface PdfMappedBlockAdapterOptions {
  ownerToken: string;
  documentId: string;
  sourceRevision: string;
  root: Element;
  /** Page section selector; the closest match owns each block. */
  pageSelector: string;
  pageNumber: (section: Element) => number;
  /** Canonical page text for offset mapping; null = mapping unavailable. */
  pageText: (pageNumber: number) => string | null;
  visibilityFactory?: (doc: Document) => PdfVisibilitySource;
}

export class PdfMappedBlockAdapter implements PassageAdapter {
  readonly ownerToken: string;
  private policy: PassagePolicyIdentity | null = null;
  private readonly listeners = new Set<(event: PassageEncounterEvent) => void>();
  private readonly records = new Map<string, MappedRecord>();
  private readonly pageRecords = new Map<Element, MappedRecord[]>();
  private readonly visibility: PdfVisibilitySource | null;
  private disposed = false;
  private readonly documentId: string;
  private readonly sourceRevision: string;

  constructor(private readonly options: PdfMappedBlockAdapterOptions) {
    this.ownerToken = options.ownerToken;
    this.documentId = options.documentId;
    this.sourceRevision = options.sourceRevision;
    const doc = options.root.ownerDocument;
    this.visibility =
      options.visibilityFactory?.(doc) ?? createPdfVisibility(doc);
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
    if (!this.visibility) return;
    const sections = Array.from(this.options.root.querySelectorAll(this.options.pageSelector));
    for (const section of sections) {
      const pageNumber = this.options.pageNumber(section);
      if (!Number.isFinite(pageNumber) || pageNumber <= 0) continue;
      let built = false;
      const enter = () => {
        if (this.disposed) return;
        if (!built) {
          built = true;
          const records = this.buildPage(section, pageNumber);
          if (records.length === 0) return;
          this.pageRecords.set(section, records);
          for (const record of records) {
            this.records.set(record.passageId, record);
            this.emit({ kind: "enter", passageId: record.passageId });
          }
          return;
        }
        for (const record of this.pageRecords.get(section) ?? []) {
          this.emit({ kind: "enter", passageId: record.passageId });
        }
      };
      const exit = () => {
        for (const record of this.pageRecords.get(section) ?? []) {
          this.emit({ kind: "exit", passageId: record.passageId });
        }
      };
      this.visibility.observe(section, enter, exit);
    }
  }

  private buildPage(section: Element, pageNumber: number): MappedRecord[] {
    const rawPageText = this.options.pageText(pageNumber);
    if (!rawPageText) return [];
    const pageText = normalizePassageText(rawPageText);
    if (pageText.length < PASSAGE_MIN_TEXT_LENGTH) return [];

    const records: MappedRecord[] = [];
    const blocks = Array.from(section.querySelectorAll(PASSAGE_BLOCK_SELECTOR)).filter(
      (element) => {
        if (element.closest(PASSAGE_EXCLUDED_SELECTOR)) return false;
        const outer = element.parentElement?.closest(PASSAGE_BLOCK_SELECTOR);
        return !outer || !section.contains(outer);
      }
    );

    for (const element of blocks) {
      const text = normalizePassageText(element.textContent ?? "");
      if (text.length < PASSAGE_MIN_TEXT_LENGTH) continue;
      for (const part of splitPassageText(text)) {
        const start = findOffset(pageText, part.text);
        if (start < 0) continue;
        const end = start + part.text.length;
        records.push({
          passageId: `pdf:${pageNumber}:${start}-${end}`,
          pageNumber,
          start,
          end,
          text: part.text,
          element,
          pageElement: section,
        });
      }
    }
    return records;
  }

  snapshot(passageId: string): PassageSnapshot | null {
    if (this.disposed || !this.policy) return null;
    const record = this.records.get(passageId);
    if (!record || !record.element.isConnected || !record.pageElement.isConnected) return null;
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

  private locatorFor(record: MappedRecord): PassageLocator {
    return {
      kind: "pdf",
      sourceType: "pdf",
      documentId: this.documentId,
      pageNumber: record.pageNumber,
      startOffset: record.start,
      endOffset: record.end,
      quote: record.text,
      rects: this.normalizedRects(record),
    };
  }

  private normalizedRects(record: MappedRecord): PassageNormalizedRect[] {
    const base = record.pageElement.getBoundingClientRect();
    if (base.width <= 0 || base.height <= 0) return [];
    const rects: PassageNormalizedRect[] = [];
    for (const rect of Array.from(record.element.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      rects.push({
        x: clamp01((rect.left - base.left) / base.width),
        y: clamp01((rect.top - base.top) / base.height),
        width: clamp01(rect.width / base.width),
        height: clamp01(rect.height / base.height),
      });
      if (rects.length >= 40) break;
    }
    return rects;
  }

  projectRects(passageId: string): PassageProjectedRect[] | null {
    if (this.disposed) return null;
    const record = this.records.get(passageId);
    if (!record || !record.element.isConnected) return null;
    const rects: PassageProjectedRect[] = [];
    for (const rect of Array.from(record.element.getClientRects())) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      rects.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
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
    this.pageRecords.clear();
    this.listeners.clear();
  }
}

function findOffset(pageText: string, quote: string): number {
  if (!quote) return -1;
  // Exact normalized mapping only. A prefix guess could place the mark at the
  // right page but the wrong range; the design requires a truthful anchor or
  // manual actions only.
  return pageText.indexOf(quote);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
