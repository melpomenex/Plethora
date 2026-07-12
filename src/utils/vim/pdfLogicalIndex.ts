import { BoundedRegionCache, buildLogicalRegion, type LogicalRegion } from "./logicalIndex";

export interface PdfTextItemSource {
  str: string;
  transform?: readonly number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface IndexedPdfPage extends LogicalRegion<number> {
  textItems: PdfTextItemSource[];
}

export type PdfPageTextLoader = (pageNumber: number, signal?: AbortSignal) => Promise<readonly PdfTextItemSource[]>;

export class PdfLogicalIndex {
  private readonly cache: BoundedRegionCache<number, IndexedPdfPage>;
  constructor(private readonly loadPage: PdfPageTextLoader, cacheSize = 9) {
    this.cache = new BoundedRegionCache(cacheSize);
  }

  async page(pageNumber: number, signal?: AbortSignal): Promise<IndexedPdfPage> {
    const cached = this.cache.get(pageNumber);
    if (cached) return cached;
    const items = sortPdfItemsReadingOrder([...await this.loadPage(pageNumber, signal)]);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const blockTexts = groupPdfItemsIntoLines(items).map((line) => line.map((item) => item.str).join(""));
    const region = buildLogicalRegion(pageNumber, blockTexts);
    const indexed = { ...region, textItems: items };
    this.cache.set(pageNumber, indexed);
    return indexed;
  }

  invalidate(pageNumber?: number): void {
    if (pageNumber === undefined) this.cache.clear(); else this.cache.delete(pageNumber);
  }
}

export function sortPdfItemsReadingOrder(items: PdfTextItemSource[]): PdfTextItemSource[] {
  if (items.length < 4) return items;
  const positioned = items.map((item, originalIndex) => ({ item, originalIndex, x: item.transform?.[4] ?? 0, y: item.transform?.[5] ?? 0 }));
  const xs = [...new Set(positioned.map((entry) => entry.x))].sort((a, b) => a - b);
  let largestGap = 0; let split = 0;
  for (let index = 1; index < xs.length; index += 1) {
    const gap = xs[index] - xs[index - 1];
    if (gap > largestGap) { largestGap = gap; split = (xs[index] + xs[index - 1]) / 2; }
  }
  const span = (xs.at(-1) ?? 0) - (xs[0] ?? 0);
  const left = positioned.filter((entry) => entry.x < split);
  const right = positioned.filter((entry) => entry.x >= split);
  if (largestGap < Math.max(80, span * .25) || left.length < 2 || right.length < 2) return items;
  const sortColumn = (a: typeof positioned[number], b: typeof positioned[number]) => {
    const y = b.y - a.y;
    return Math.abs(y) > 3 ? y : a.x - b.x || a.originalIndex - b.originalIndex;
  };
  return [...left.sort(sortColumn), ...right.sort(sortColumn)].map((entry) => entry.item);
}

export function groupPdfItemsIntoLines(items: readonly PdfTextItemSource[]): PdfTextItemSource[][] {
  const lines: PdfTextItemSource[][] = [];
  let line: PdfTextItemSource[] = [];
  let previousY: number | null = null;
  for (const item of items) {
    const y = item.transform?.[5] ?? previousY ?? 0;
    const lineBreak = previousY !== null && Math.abs(y - previousY) > Math.max(2, (item.height ?? 0) * 0.45);
    if (lineBreak && line.length) { lines.push(line); line = []; }
    line.push(item);
    previousY = y;
    if (item.hasEOL) { lines.push(line); line = []; previousY = null; }
  }
  if (line.length) lines.push(line);
  return lines;
}
