/**
 * Typed attachment snapshots and removed-source markers (design D3, task 2.2).
 *
 * Adapters from the existing viewer/Queue/mobile registry context
 * (`AssistantContext`) into the canonical typed shapes the routing table and
 * repository consume. Rules:
 *
 *  - Publishers must own their pane: only the active publisher's snapshot may
 *    become the inferred current context (`active-pane ownership`).
 *  - A document/source change replaces inferred current context only; explicit
 *    and pinned attachments survive.
 *  - Removing optional context suppresses reattachment for that source
 *    identity/version in that conversation, so playback/render updates and
 *    remounts never silently re-add it.
 */

import type {
  SourceAttachment,
  SourceLocator,
  SourceReference,
} from "./conversations/types";
import type { ViewerSnapshot } from "./routing";

/** Structural view of `AssistantContext` (avoids a component import). */
export interface AssistantContextLike {
  type: "document" | "web" | "video" | "general";
  documentId?: string;
  url?: string;
  selection?: string;
  position?: { pageNumber?: number; scrollPercent?: number; currentTime?: number };
  metadata?: { title?: string; duration?: number; videoId?: string };
  content?: string;
  privacyDocumentIds?: string[];
  status?: "ready" | "loading" | "unavailable";
  source?: string;
}

export interface PublisherIdentity {
  /** Tab/pane that owns the context; hidden panes must not contribute. */
  ownerTabId: string;
  ownerPaneId: string;
  /** Publisher revision; a stale revision is ignored. */
  revision: string;
  active: boolean;
}

/** Convert the viewer's context into a typed viewer snapshot. */
export function snapshotFromAssistantContext(
  context: AssistantContextLike | null | undefined,
): ViewerSnapshot | undefined {
  if (!context || context.type === "general") return undefined;
  const position: ViewerSnapshot["position"] = {};
  if (context.position?.pageNumber !== undefined) position.page = context.position.pageNumber;
  if (context.position?.currentTime !== undefined) position.timeSeconds = context.position.currentTime;
  const ephemeral = context.privacyDocumentIds?.length === 0 && context.url
    ? {
        ownerToken: `viewer:${context.url}`,
        sourceType: context.type === "video" ? "video" : "web",
        localOnly: true as const,
      }
    : undefined;
  return {
    kind: context.type,
    libraryId: context.documentId && !context.documentId.startsWith("extract:") ? context.documentId : undefined,
    ephemeral,
    title: context.metadata?.title,
    position: Object.keys(position).length ? position : undefined,
    selection: context.selection,
  };
}

/** True when a source identity can actually be attached (fail closed). */
export function isAttachableSnapshot(snapshot: ViewerSnapshot | undefined): boolean {
  if (!snapshot) return false;
  if (snapshot.libraryId) return true;
  // Ephemeral viewer content requires a live capability identity; a bare
  // title or URL is not an identity.
  return Boolean(snapshot.ephemeral?.ownerToken);
}

export function locatorFromSnapshot(snapshot: ViewerSnapshot): SourceLocator | undefined {
  const locator: SourceLocator = {};
  if (snapshot.position?.page !== undefined) locator.page = snapshot.position.page;
  if (snapshot.position?.cfi) locator.cfi = snapshot.position.cfi;
  if (snapshot.position?.sectionId) locator.sectionId = snapshot.position.sectionId;
  if (snapshot.position?.timeSeconds !== undefined) locator.timeSeconds = snapshot.position.timeSeconds;
  if (snapshot.position?.anchor) locator.anchor = snapshot.position.anchor;
  if (snapshot.selection) locator.quote = snapshot.selection;
  return Object.keys(locator).length ? locator : undefined;
}

/**
 * Build a typed attachment from a viewer snapshot. `attachmentId` is
 * deterministic for a source identity so repeated publishes converge instead
 * of stacking duplicates.
 */
export function attachmentFromSnapshot(options: {
  snapshot: ViewerSnapshot;
  origin: SourceAttachment["origin"];
  role?: SourceAttachment["role"];
  active?: boolean;
  contentVersion?: string;
}): SourceAttachment | null {
  const { snapshot } = options;
  if (!isAttachableSnapshot(snapshot)) return null;
  const identity = snapshot.libraryId ?? snapshot.ephemeral!.ownerToken;
  return {
    attachmentId: `att-${stableKey(identity)}`,
    kind: snapshot.kind === "general" ? "web" : snapshot.kind,
    libraryId: snapshot.libraryId,
    ephemeral: snapshot.ephemeral,
    title: snapshot.title ?? snapshot.libraryId ?? "Current source",
    contentVersion: options.contentVersion,
    locator: locatorFromSnapshot(snapshot),
    origin: options.origin,
    role: options.role ?? "optional",
    active: options.active ?? true,
  };
}

function stableKey(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/* ------------------------------------------------------------------ */
/* Active-pane ownership and source-change labels                      */
/* ------------------------------------------------------------------ */

export interface PublishedContext {
  identity: PublisherIdentity;
  snapshot?: ViewerSnapshot;
}

/**
 * Registry of publisher contexts. Only the *active* publisher with the newest
 * revision contributes the inferred current context; hidden panes cannot
 * attach evidence.
 */
export class PublisherRegistry {
  private publishers = new Map<string, PublishedContext>();

  publish(identity: PublisherIdentity, snapshot: ViewerSnapshot | undefined): void {
    const key = `${identity.ownerTabId}:${identity.ownerPaneId}`;
    const existing = this.publishers.get(key);
    if (existing && existing.identity.revision === identity.revision) return;
    this.publishers.set(key, { identity, snapshot });
  }

  /** Remove a pane's contribution (view teardown). */
  withdraw(identity: Pick<PublisherIdentity, "ownerTabId" | "ownerPaneId">): void {
    this.publishers.delete(`${identity.ownerTabId}:${identity.ownerPaneId}`);
  }

  /**
   * The inferred current context. Returns `undefined` when no publisher is
   * active or the active publisher's source has no attachable identity.
   */
  currentContext(): ViewerSnapshot | undefined {
    const active = [...this.publishers.values()].filter((entry) => entry.identity.active);
    if (active.length === 0) return undefined;
    // Newest revision wins among active publishers; ties fall back to
    // insertion (first active pane), never to a hidden pane.
    active.sort((a, b) => (a.identity.revision < b.identity.revision ? 1 : -1));
    const snapshot = active[0].snapshot;
    return isAttachableSnapshot(snapshot) ? snapshot : undefined;
  }
}

export interface SourceChangeLabel {
  changed: boolean;
  previousTitle?: string;
  nextTitle?: string;
  /** Inferred context was replaced; explicit/pinned kept. */
  keptAttachments: SourceAttachment[];
}

/**
 * Apply a document/source change to a conversation's attachments.
 *
 * Only inferred `active-view` attachments are replaced. Explicit
 * (picker/mention/selection) attachments and pinned selections survive; the
 * label reports the change so the UI can announce it.
 */
export function applySourceChange(options: {
  attachments: SourceAttachment[];
  previousSnapshot?: ViewerSnapshot;
  nextSnapshot?: ViewerSnapshot;
  removedRegistry: RemovedSourceRegistry;
  conversationId: string;
}): { attachments: SourceAttachment[]; label: SourceChangeLabel } {
  const { attachments, previousSnapshot, nextSnapshot, removedRegistry, conversationId } = options;
  const kept = attachments.filter((attachment) => attachment.origin !== "active-view");
  const changed =
    (previousSnapshot?.libraryId ?? previousSnapshot?.ephemeral?.ownerToken ?? undefined) !==
    (nextSnapshot?.libraryId ?? nextSnapshot?.ephemeral?.ownerToken ?? undefined);
  let nextAttachments = kept;
  if (nextSnapshot && isAttachableSnapshot(nextSnapshot)) {
    const candidate = attachmentFromSnapshot({
      snapshot: nextSnapshot,
      origin: "active-view",
      active: true,
    });
    if (candidate && !removedRegistry.isRemoved(conversationId, candidate)) {
      nextAttachments = [candidate, ...kept];
    }
  }
  return {
    attachments: nextAttachments,
    label: {
      changed,
      previousTitle: previousSnapshot?.title,
      nextTitle: nextSnapshot?.title,
      keptAttachments: kept,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Removed-source markers                                              */
/* ------------------------------------------------------------------ */

/**
 * Remembers sources the user removed so the same identity/version is not
 * silently reattached in that conversation. Removing *selection* context
 * affects future primary context but never historical source records.
 */
export class RemovedSourceRegistry {
  /** conversationId → set of `identity@version` keys */
  private removed = new Map<string, Set<string>>();

  private keyFor(source: Pick<SourceReference, "attachmentId" | "libraryId" | "ephemeral" | "contentVersion">): string {
    const identity = source.libraryId ?? source.ephemeral?.ownerToken ?? source.attachmentId;
    return `${identity}@${source.contentVersion ?? "unversioned"}`;
  }

  markRemoved(
    conversationId: string,
    source: Pick<SourceReference, "attachmentId" | "libraryId" | "ephemeral" | "contentVersion">,
  ): void {
    const set = this.removed.get(conversationId) ?? new Set<string>();
    set.add(this.keyFor(source));
    this.removed.set(conversationId, set);
  }

  isRemoved(
    conversationId: string,
    source: Pick<SourceReference, "attachmentId" | "libraryId" | "ephemeral" | "contentVersion">,
  ): boolean {
    return this.removed.get(conversationId)?.has(this.keyFor(source)) ?? false;
  }

  /**
   * Reattachment is only possible after the source content changes (a new
   * version is a genuinely different thing to attach).
   */
  mayReattach(conversationId: string, source: Pick<SourceReference, "attachmentId" | "libraryId" | "ephemeral" | "contentVersion">): boolean {
    return !this.isRemoved(conversationId, source);
  }

  clearConversation(conversationId: string): void {
    this.removed.delete(conversationId);
  }
}
