import { BoundedRegionCache, buildLogicalRegion, type LogicalRegion } from "./logicalIndex";

export interface EpubSectionSource {
  spineIndex: number;
  href: string;
  load(signal?: AbortSignal): Promise<Document | string>;
  cfiForElement?: (element: Element, edge: "start" | "end") => string;
  cfiForTextOffset?: (element: Element, offset: number, edge: "start" | "end") => string;
  cfiForRange?: (startOffset: number, endOffset: number) => Promise<string> | string;
}

export interface EpubBlockBoundary {
  blockIndex: number;
  startCfi: string;
  endCfi: string;
}

export interface IndexedEpubSection extends LogicalRegion<number> {
  href: string;
  cfiBoundaries: EpubBlockBoundary[];
  tokenCfis: Map<number, { startCfi: string; endCfi: string }>;
}

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption,dt,dd,td,th";

export class EpubLogicalIndex {
  private readonly bySpine = new Map<number, EpubSectionSource>();
  private readonly cache: BoundedRegionCache<number, IndexedEpubSection>;

  constructor(sections: readonly EpubSectionSource[], cacheSize = 5) {
    sections.forEach((section) => this.bySpine.set(section.spineIndex, section));
    this.cache = new BoundedRegionCache(cacheSize);
  }

  async section(spineIndex: number, signal?: AbortSignal): Promise<IndexedEpubSection | null> {
    const cached = this.cache.get(spineIndex);
    if (cached) return cached;
    const source = this.bySpine.get(spineIndex);
    if (!source) return null;
    const loaded = await source.load(signal);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const document = typeof loaded === "string" ? new DOMParser().parseFromString(loaded, "text/html") : loaded;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    const blocks = candidates.length > 0
      ? candidates.filter((element) => !element.parentElement?.closest(BLOCK_SELECTOR))
      : document.body ? [document.body] : [];
    const blockTexts = blocks.map((element) => element.textContent ?? "");
    const region = buildLogicalRegion(spineIndex, blockTexts);
    const cfiBoundaries = source.cfiForElement
      ? blocks.map((element, blockIndex) => ({
          blockIndex,
          startCfi: source.cfiForElement!(element, "start"),
          endCfi: source.cfiForElement!(element, "end"),
        }))
      : [];
    const tokenCfis = new Map<number, { startCfi: string; endCfi: string }>();
    if (source.cfiForTextOffset) {
      region.blocks.forEach((block, blockIndex) => {
        const element = blocks[blockIndex];
        block.tokens.forEach((token) => {
          const localStart = token.startOffset - block.startOffset;
          const localEnd = token.endOffset - block.startOffset;
          tokenCfis.set(token.index, {
            startCfi: source.cfiForTextOffset!(element, localStart, "start"),
            endCfi: source.cfiForTextOffset!(element, localEnd, "end"),
          });
        });
      });
    }
    const indexed = { ...region, href: source.href, cfiBoundaries, tokenCfis };
    this.cache.set(spineIndex, indexed);
    return indexed;
  }

  prefetchAdjacent(spineIndex: number): void {
    const idle = globalThis.requestIdleCallback ?? ((callback: IdleRequestCallback) => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 0));
    idle(() => {
      void this.section(spineIndex - 1).catch(() => undefined);
      void this.section(spineIndex + 1).catch(() => undefined);
    });
  }

  async cfiRange(spineIndex: number, startOffset: number, endOffset: number): Promise<string | null> {
    const source = this.bySpine.get(spineIndex);
    return source?.cfiForRange ? source.cfiForRange(startOffset, endOffset) : null;
  }

  invalidate(spineIndex?: number): void {
    if (spineIndex === undefined) this.cache.clear(); else this.cache.delete(spineIndex);
  }
}
