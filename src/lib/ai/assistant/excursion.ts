/**
 * Citation excursion and return (design D6, task 3.5).
 *
 * Opening a citation is a *temporary exploration*: it must not silently commit
 * a new reading position, and returning must restore the conversation scroll,
 * draft and reader location. A closed origin or deleted target falls back to
 * the saved thread without inventing a scroll target.
 */

import type { SourceLocator } from "./conversations/types";

export interface ReaderOrigin {
  tabId: string;
  documentId?: string;
  locator?: SourceLocator;
  /** Scroll offset within the reader (implementation-specific unit). */
  scrollOffset?: number;
}

export interface ConversationOrigin {
  conversationId: string;
  turnId?: string;
  presentation: "sidebar" | "workspace" | "mobile" | "pwa";
  detent?: "closed" | "partial" | "expanded";
  transcriptScroll?: number;
  draftRevision?: number;
  /** Focus restoration target id, when the surface provides one. */
  focusTargetId?: string;
}

export interface ExcursionRecord {
  id: string;
  createdAt: number;
  conversation: ConversationOrigin;
  reader: ReaderOrigin;
  target: {
    documentId: string;
    locator?: SourceLocator;
    citationId?: string;
  };
  /** Explicit commit ("Continue reading here") replaces the origin. */
  committed: boolean;
}

export function buildExcursionRecord(options: {
  id: string;
  now?: () => number;
  conversation: ConversationOrigin;
  reader: ReaderOrigin;
  target: ExcursionRecord["target"];
}): ExcursionRecord {
  return {
    id: options.id,
    createdAt: (options.now ?? Date.now)(),
    conversation: options.conversation,
    reader: options.reader,
    target: options.target,
    committed: false,
  };
}

export type ReturnOutcome =
  | {
      kind: "restored";
      conversation: ConversationOrigin;
      reader: ReaderOrigin;
    }
  | {
      kind: "origin-closed";
      /** Reopen the thread without inventing a scroll target. */
      conversation: ConversationOrigin;
      reason: string;
    }
  | {
      kind: "target-deleted";
      conversation: ConversationOrigin;
      reason: string;
    };

/**
 * Resolve the return of a citation excursion.
 *
 * - The default return is the saved origin (thread scroll, draft, reader
 *   position) — the temporary jump never overwrites reading progress.
 * - A committed excursion intentionally becomes the new origin.
 * - Deleted targets report why and return to the thread; a closed origin
 *   reopens the thread with no fabricated position.
 */
export function resolveReturn(options: {
  record: ExcursionRecord;
  /** Current state of the reader tab that hosted the origin. */
  originTabOpen: boolean;
  /** Whether the cited target still exists. */
  targetExists: boolean;
  /** The conversation origin as it stands now (draft may have advanced). */
  currentConversation?: Partial<ConversationOrigin>;
}): ReturnOutcome {
  const conversation: ConversationOrigin = {
    ...options.record.conversation,
    ...options.currentConversation,
  };
  if (options.record.committed) {
    // "Continue reading here" replaced the origin deliberately.
    return {
      kind: "restored",
      conversation,
      reader: {
        ...options.record.reader,
        documentId: options.record.target.documentId,
        locator: options.record.target.locator,
      },
    };
  }
  if (!options.targetExists) {
    return {
      kind: "target-deleted",
      conversation,
      reason: "The cited source is no longer available; the conversation is unchanged.",
    };
  }
  if (!options.originTabOpen) {
    return {
      kind: "origin-closed",
      conversation,
      reason: "The original reading view was closed; the conversation is restored.",
    };
  }
  return {
    kind: "restored",
    conversation,
    reader: options.record.reader,
  };
}

/**
 * Commit a temporary excursion as the new reading position (explicit user
 * action only). Mutates and returns the record for storage.
 */
export function commitExcursion(record: ExcursionRecord): ExcursionRecord {
  return {
    ...record,
    committed: true,
    reader: {
      ...record.reader,
      documentId: record.target.documentId,
      locator: record.target.locator,
    },
  };
}

/**
 * Whether a temporary jump may overwrite the *stored* reading progress.
 * Temporary excursion never may; only an explicit commit does.
 */
export function mayOverwriteReadingProgress(record: ExcursionRecord): boolean {
  return record.committed;
}
