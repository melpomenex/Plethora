import type { Collection } from "./collection";
import type { Document } from "./document";
import type { QueueItem } from "./queue";

export const STARTUP_DATA_VERSION = 1;
export const STARTUP_DOCUMENT_LIMIT = 50;
export const STARTUP_QUEUE_LIMIT = 50;
export const STARTUP_PROGRESS_LIMIT = 10;
export const STARTUP_RESPONSE_BYTE_BUDGET = 256 * 1024;

export interface StartupPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/** Content-free document projection used before a document is opened. */
export type StartupDocumentSummary = Omit<Document, "content" | "contentHash" | "metadata" | "coverImageUrl" | "coverImageSource">;

export interface StartupProgressItem {
  id: string;
  progress: number;
  title: string;
  /** Unix epoch milliseconds after API-boundary normalization. */
  date_modified: number | null;
  /** Import/add time in Unix epoch milliseconds after API-boundary normalization. */
  date_added: number | null;
}

export interface StartupSnapshot {
  version: number;
  collections: Collection[];
  activeCollectionId: string;
  documents: StartupPage<StartupDocumentSummary>;
  queue: StartupPage<QueueItem>;
  continueReading: StartupProgressItem[];
  dueCount: number;
}

export type StartupSurface = "dashboard" | "continue-reading" | "queue";
