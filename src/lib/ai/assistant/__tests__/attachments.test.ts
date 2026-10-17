/**
 * Attachment publisher, removed-source and ephemeral capability tests
 * (tasks 2.2/2.5).
 */

import { describe, expect, it } from "vitest";
import {
  PublisherRegistry,
  RemovedSourceRegistry,
  applySourceChange,
  attachmentFromSnapshot,
  isAttachableSnapshot,
  snapshotFromAssistantContext,
} from "../attachments";
import {
  EphemeralCapabilityRegistry,
  authorizeEphemeralContext,
  hasRealSourceIdentity,
} from "../ephemeralSources";

describe("viewer snapshot conversion", () => {
  it("maps a document context to a typed snapshot", () => {
    const snapshot = snapshotFromAssistantContext({
      type: "document",
      documentId: "doc-1",
      metadata: { title: "A PDF" },
      position: { pageNumber: 12 },
      selection: "Selected text",
    });
    expect(snapshot).toMatchObject({
      kind: "document",
      libraryId: "doc-1",
      title: "A PDF",
      position: { page: 12 },
      selection: "Selected text",
    });
  });

  it("marks unsaved web content ephemeral with a live owner token", () => {
    const snapshot = snapshotFromAssistantContext({
      type: "web",
      url: "https://example.com/unsaved",
      privacyDocumentIds: [],
      metadata: { title: "Unsaved article" },
    });
    expect(snapshot?.libraryId).toBeUndefined();
    expect(snapshot?.ephemeral?.ownerToken).toContain("example.com");
    expect(snapshot?.ephemeral?.localOnly).toBe(true);
  });

  it("treats extract pseudo-ids as non-library identities", () => {
    const snapshot = snapshotFromAssistantContext({
      type: "document",
      documentId: "extract:123",
    });
    expect(snapshot?.libraryId).toBeUndefined();
  });

  it("refuses attachable status without a real identity", () => {
    expect(isAttachableSnapshot({ kind: "web", title: "No identity" })).toBe(false);
    expect(isAttachableSnapshot({ kind: "document", libraryId: "doc-1" })).toBe(true);
    expect(
      isAttachableSnapshot({
        kind: "web",
        ephemeral: { ownerToken: "viewer:x", sourceType: "web", localOnly: true },
      }),
    ).toBe(true);
  });
});

describe("active-pane ownership", () => {
  it("only the active publisher contributes current context", () => {
    const registry = new PublisherRegistry();
    registry.publish(
      { ownerTabId: "tab-1", ownerPaneId: "reader", revision: "1", active: false },
      { kind: "document", libraryId: "doc-hidden", title: "Hidden" },
    );
    registry.publish(
      { ownerTabId: "tab-2", ownerPaneId: "reader", revision: "1", active: true },
      { kind: "document", libraryId: "doc-active", title: "Active" },
    );
    expect(registry.currentContext()?.libraryId).toBe("doc-active");
  });

  it("withdrawing a pane removes its contribution", () => {
    const registry = new PublisherRegistry();
    registry.publish(
      { ownerTabId: "tab-1", ownerPaneId: "reader", revision: "1", active: true },
      { kind: "document", libraryId: "doc-1" },
    );
    registry.withdraw({ ownerTabId: "tab-1", ownerPaneId: "reader" });
    expect(registry.currentContext()).toBeUndefined();
  });

  it("a newer revision supersedes an older one from the same pane", () => {
    const registry = new PublisherRegistry();
    registry.publish(
      { ownerTabId: "tab-1", ownerPaneId: "reader", revision: "001", active: true },
      { kind: "document", libraryId: "doc-old" },
    );
    registry.publish(
      { ownerTabId: "tab-1", ownerPaneId: "reader", revision: "002", active: true },
      { kind: "document", libraryId: "doc-new" },
    );
    expect(registry.currentContext()?.libraryId).toBe("doc-new");
  });

  it("no active publisher means no inferred context", () => {
    const registry = new PublisherRegistry();
    registry.publish(
      { ownerTabId: "tab-1", ownerPaneId: "reader", revision: "1", active: false },
      { kind: "document", libraryId: "doc-1" },
    );
    expect(registry.currentContext()).toBeUndefined();
  });
});

describe("source change labels", () => {
  it("replaces inferred context but preserves explicit and pinned attachments", () => {
    const removedRegistry = new RemovedSourceRegistry();
    const explicit = attachmentFromSnapshot({
      snapshot: { kind: "document", libraryId: "doc-explicit", title: "Explicit" },
      origin: "picker",
    })!;
    const inferredOld = attachmentFromSnapshot({
      snapshot: { kind: "document", libraryId: "doc-a", title: "PDF A", position: { page: 3 } },
      origin: "active-view",
    })!;
    const result = applySourceChange({
      attachments: [inferredOld, explicit],
      previousSnapshot: { kind: "document", libraryId: "doc-a", title: "PDF A" },
      nextSnapshot: { kind: "document", libraryId: "doc-b", title: "PDF B", position: { page: 1 } },
      removedRegistry,
      conversationId: "conv-1",
    });
    expect(result.label.changed).toBe(true);
    expect(result.label.nextTitle).toBe("PDF B");
    expect(result.attachments.map((a) => a.libraryId).sort()).toEqual(["doc-b", "doc-explicit"]);
    // The old inferred attachment is gone; explicit kept.
    expect(result.attachments.some((a) => a.libraryId === "doc-a")).toBe(false);
    expect(result.label.keptAttachments).toHaveLength(1);
    expect(result.label.keptAttachments[0].libraryId).toBe("doc-explicit");
  });

  it("does not reattach a removed source revision on playback/render updates", () => {
    const removedRegistry = new RemovedSourceRegistry();
    const source = {
      attachmentId: "att-doc-a",
      libraryId: "doc-a",
    };
    removedRegistry.markRemoved("conv-1", source);
    const first = applySourceChange({
      attachments: [],
      previousSnapshot: { kind: "document", libraryId: "doc-a" },
      nextSnapshot: { kind: "document", libraryId: "doc-a", position: { timeSeconds: 30 } },
      removedRegistry,
      conversationId: "conv-1",
    });
    // Repeated render/playback updates keep it removed.
    const second = applySourceChange({
      attachments: first.attachments,
      previousSnapshot: { kind: "document", libraryId: "doc-a" },
      nextSnapshot: { kind: "document", libraryId: "doc-a", position: { timeSeconds: 60 } },
      removedRegistry,
      conversationId: "conv-1",
    });
    expect(first.attachments).toHaveLength(0);
    expect(second.attachments).toHaveLength(0);
  });

  it("a new content version is attachable again", () => {
    const removedRegistry = new RemovedSourceRegistry();
    removedRegistry.markRemoved("conv-1", {
      attachmentId: "att",
      libraryId: "doc-a",
      contentVersion: "v1",
    });
    expect(
      removedRegistry.mayReattach("conv-1", {
        attachmentId: "att",
        libraryId: "doc-a",
        contentVersion: "v1",
      }),
    ).toBe(false);
    expect(
      removedRegistry.mayReattach("conv-1", {
        attachmentId: "att",
        libraryId: "doc-a",
        contentVersion: "v2",
      }),
    ).toBe(true);
  });
});

describe("ephemeral capabilities (task 2.5)", () => {
  function fixedClock(start = 1_000): { now: () => number; set: (v: number) => void } {
    let value = start;
    return { now: () => value, set: (v) => (value = v) };
  }

  it("authorizes live unsaved content and refuses expired tokens", () => {
    const clock = fixedClock();
    const registry = new EphemeralCapabilityRegistry(clock.now);
    registry.issue({
      ownerToken: "viewer:article",
      sourceType: "web",
      ownerSurface: "reader",
      expiresAt: 2_000,
    });
    const allowed = authorizeEphemeralContext(registry, {
      ownerToken: "viewer:article",
      sourceType: "web",
      content: "Live article text",
      localOnly: true,
    });
    expect(allowed.allowed).toBe(true);

    clock.set(2_500);
    const expired = authorizeEphemeralContext(registry, {
      ownerToken: "viewer:article",
      sourceType: "web",
      content: "Live article text",
      localOnly: true,
    });
    expect(expired.allowed).toBe(false);
    if (expired.allowed === false) expect(expired.reason).toBe("expired_or_unknown");
  });

  it("refuses unknown tokens and source-type mismatches", () => {
    const registry = new EphemeralCapabilityRegistry();
    registry.issue({ ownerToken: "viewer:a", sourceType: "web", ownerSurface: "reader" });
    const unknown = authorizeEphemeralContext(registry, {
      ownerToken: "viewer:b",
      sourceType: "web",
      content: "x",
      localOnly: true,
    });
    expect(unknown.allowed).toBe(false);
    const mismatch = authorizeEphemeralContext(registry, {
      ownerToken: "viewer:a",
      sourceType: "video",
      content: "x",
      localOnly: true,
    });
    expect(mismatch.allowed).toBe(false);
    const empty = authorizeEphemeralContext(registry, {
      ownerToken: "viewer:a",
      sourceType: "web",
      content: "   ",
      localOnly: true,
    });
    expect(empty.allowed).toBe(false);
  });

  it("revoking a surface invalidates its tokens (pane closed)", () => {
    const registry = new EphemeralCapabilityRegistry();
    registry.issue({ ownerToken: "viewer:a", sourceType: "web", ownerSurface: "reader" });
    registry.issue({ ownerToken: "viewer:b", sourceType: "web", ownerSurface: "pwa" });
    registry.revokeSurface("reader");
    expect(registry.isLive("viewer:a", "web")).toBe(false);
    expect(registry.isLive("viewer:b", "web")).toBe(true);
  });

  it("sweeps expired tokens", () => {
    const clock = fixedClock();
    const registry = new EphemeralCapabilityRegistry(clock.now);
    registry.issue({ ownerToken: "a", sourceType: "web", ownerSurface: "reader", expiresAt: 1_100 });
    registry.issue({ ownerToken: "b", sourceType: "web", ownerSurface: "reader" });
    clock.set(2_000);
    expect(registry.sweep()).toBe(1);
    expect(registry.isLive("b", "web")).toBe(true);
  });
});

describe("source identity rules", () => {
  it("requires exactly one identity (library id xor ephemeral)", () => {
    expect(hasRealSourceIdentity({ libraryId: "doc-1" })).toBe(true);
    expect(
      hasRealSourceIdentity({ ephemeral: { ownerToken: "t", sourceType: "web" } }),
    ).toBe(true);
    expect(hasRealSourceIdentity({})).toBe(false);
    expect(
      hasRealSourceIdentity({
        libraryId: "doc-1",
        ephemeral: { ownerToken: "t", sourceType: "web" },
      }),
    ).toBe(false);
  });

  it("never fabricates a library id for unsaved viewer content", () => {
    const snapshot = snapshotFromAssistantContext({
      type: "web",
      url: "https://example.com/a",
      privacyDocumentIds: [],
    });
    const attachment = attachmentFromSnapshot({
      snapshot: snapshot!,
      origin: "active-view",
    });
    expect(attachment?.libraryId).toBeUndefined();
    expect(hasRealSourceIdentity(attachment!)).toBe(true);
  });
});
