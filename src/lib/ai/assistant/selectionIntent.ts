/**
 * Canonical selection entry intent (design D7, task 4.1).
 *
 * Queue/reader selection actions build one typed intent that the existing
 * global mobile host (or the selection Ask adapter while the flag is off)
 * consumes. The intent captures the passage *before* the transient selection
 * disappears and carries a stable handoff id so the same handoff reopens the
 * same thread and a genuinely different selection prepares a new one.
 */

import type {
  ContextPolicy,
  SelectionSnapshot,
  SourceReference,
} from "./conversations/types";

export interface SelectionEntryRequest {
  /** Captured verbatim before the highlight disappears. */
  selectedText: string;
  documentId?: string;
  documentTitle?: string;
  /** Source-appropriate position captured with the selection. */
  locator?: SelectionSnapshot["locator"];
  /** Whether the selection came from an ephemeral (unsaved) viewer. */
  ephemeral?: SelectionSnapshot["ephemeral"];
  /** The action the user chose. */
  action: "ask" | "ask-library" | "explain" | "flashcard";
}

export interface SelectionEntryIntent {
  /** Deterministic per (passage, source, action) handoff identity. */
  handoffId: string;
  kind: "prefill";
  question?: string;
  selectionSnapshot: SelectionSnapshot;
  sourceAttachments: SourceReference[];
  restriction: ContextPolicy;
  origin: { surface: string; conversationId?: string };
}

function digest(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Build the typed intent. Deterministic: the same captured passage/source and
 * action always yields the same handoff id, so a reopen (or a duplicate
 * delivery) resolves to the same prepared thread.
 */
export function buildSelectionEntryIntent(options: {
  request: SelectionEntryRequest;
  surface: string;
  conversationId?: string;
  ownerProfileId: string;
}): SelectionEntryIntent {
  const { request } = options;
  const snapshot: SelectionSnapshot = {
    originalText: request.selectedText,
    documentId: request.documentId,
    title: request.documentTitle,
    locator: request.locator,
    ephemeral: request.ephemeral,
  };
  const handoffId = `sel-${digest(
    `${options.ownerProfileId}\u0000${request.documentId ?? ""}\u0000${request.selectedText}\u0000${request.action}`,
  )}`;
  const attachments: SourceReference[] = [];
  if (request.documentId || request.ephemeral) {
    attachments.push({
      attachmentId: `att-${handoffId}`,
      kind: "selection",
      libraryId: request.documentId,
      ephemeral: request.ephemeral,
      title: request.documentTitle ?? "Selected passage",
      locator: request.locator,
      origin: "selection",
      role: request.action === "ask-library" ? "optional" : "required",
    });
  }
  return {
    handoffId,
    kind: "prefill",
    selectionSnapshot: snapshot,
    sourceAttachments: attachments,
    // Passage-scope by default: only the captured passage, no library
    // retrieval. "Ask my library" deliberately widens and says so.
    restriction:
      request.action === "ask-library"
        ? { mode: "library", origin: "entry" }
        : { mode: "document", origin: "entry" },
    origin: { surface: options.surface, conversationId: options.conversationId },
  };
}

/**
 * Decide whether a new selection resumes the current thread or prepares a new
 * one. Design D3/D7: a new selection starts its own thread unless the user
 * explicitly adds it to the existing conversation.
 */
export function selectionThreadDecision(options: {
  intent: SelectionEntryIntent;
  currentHandoffId?: string;
  currentHasMessages: boolean;
  explicitAddToConversation?: boolean;
}): { reuseCurrent: boolean; reason: string } {
  if (options.explicitAddToConversation) {
    return { reuseCurrent: true, reason: "user explicitly added the selection to this conversation" };
  }
  if (!options.currentHasMessages) {
    return { reuseCurrent: true, reason: "the prepared thread has no content yet" };
  }
  if (options.currentHandoffId && options.currentHandoffId === options.intent.handoffId) {
    return { reuseCurrent: true, reason: "the same handoff is being reopened" };
  }
  return { reuseCurrent: false, reason: "a different selection prepares its own thread" };
}

/** Exactly-once acknowledgment for a handoff. */
export class HandoffAcknowledgments {
  private acknowledged = new Set<string>();

  /** Returns false when this handoff was already acknowledged/delivered. */
  acknowledge(handoffId: string): boolean {
    if (this.acknowledged.has(handoffId)) return false;
    this.acknowledged.add(handoffId);
    return true;
  }

  isAcknowledged(handoffId: string): boolean {
    return this.acknowledged.has(handoffId);
  }

  /**
   * Reopen the same handoff after a dismissal: the acknowledgment is cleared
   * so the intent can be re-delivered once, but a *newer* intent still wins
   * over a stale redelivery.
   */
  release(handoffId: string): void {
    this.acknowledged.delete(handoffId);
  }
}
