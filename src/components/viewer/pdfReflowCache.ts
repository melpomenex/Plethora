import { openDB, type IDBPDatabase } from "idb";
import {
  parsePdfReflowDocument,
  pdfReflowCacheKey,
  serializePdfReflowDocument,
  type PdfReflowDocument,
  type PdfReflowPage,
} from "./pdfReflowTypes";
import { isTauri } from "../../lib/tauri";
import { putPdfReflowCachePage } from "../../api/documents";

export interface PdfReflowCache {
  get(key: string): Promise<PdfReflowDocument | null>;
  put(document: PdfReflowDocument): Promise<void>;
  putPage(document: PdfReflowDocument, page: PdfReflowPage): Promise<PdfReflowDocument>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryPdfReflowCache implements PdfReflowCache {
  private readonly values = new Map<string, string>();
  async get(key: string): Promise<PdfReflowDocument | null> {
    return parsePdfReflowDocument(this.values.get(key) ?? "");
  }
  async put(document: PdfReflowDocument): Promise<void> {
    this.values.set(pdfReflowCacheKey(document), serializePdfReflowDocument(document));
  }
  async putPage(document: PdfReflowDocument, page: PdfReflowPage): Promise<PdfReflowDocument> {
    const next = { ...document, pages: { ...document.pages, [page.pageNumber]: page }, updatedAt: Date.now() };
    await this.put(next);
    return next;
  }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async clear(): Promise<void> { this.values.clear(); }
}

const DB_NAME = "incrementum-pdf-reflow";
const STORE_NAME = "documents";

export class IndexedDbPdfReflowCache implements PdfReflowCache {
  private dbPromise: Promise<IDBPDatabase> | null = null;
  private db(): Promise<IDBPDatabase> {
    this.dbPromise ??= openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      },
    });
    return this.dbPromise;
  }
  async get(key: string): Promise<PdfReflowDocument | null> {
    const raw = await (await this.db()).get(STORE_NAME, key);
    return typeof raw === "string" ? parsePdfReflowDocument(raw) : null;
  }
  async put(document: PdfReflowDocument): Promise<void> {
    await (await this.db()).put(STORE_NAME, serializePdfReflowDocument(document), pdfReflowCacheKey(document));
  }
  async putPage(document: PdfReflowDocument, page: PdfReflowPage): Promise<PdfReflowDocument> {
    const next = { ...document, pages: { ...document.pages, [page.pageNumber]: page }, updatedAt: Date.now() };
    await this.put(next);
    return next;
  }
  async delete(key: string): Promise<void> { await (await this.db()).delete(STORE_NAME, key); }
  async clear(): Promise<void> { await (await this.db()).clear(STORE_NAME); }
}

export function createBrowserPdfReflowCache(): PdfReflowCache {
  const browser = typeof indexedDB === "undefined" ? new MemoryPdfReflowCache() : new IndexedDbPdfReflowCache();
  if (!isTauri()) return browser;
  return {
    get: (key) => browser.get(key),
    put: (document) => browser.put(document),
    delete: (key) => browser.delete(key),
    clear: () => browser.clear(),
    async putPage(document, page) {
      const next = await browser.putPage(document, page);
      await putPdfReflowCachePage({
        documentId: document.documentId,
        sourceIdentity: document.sourceIdentity,
        schemaVersion: document.schemaVersion,
        engineVersion: document.engineVersion,
        pageNumber: page.pageNumber,
        page,
      }).catch((error) => console.warn("[PDF reflow] Native cache write failed", error));
      return next;
    },
  };
}
