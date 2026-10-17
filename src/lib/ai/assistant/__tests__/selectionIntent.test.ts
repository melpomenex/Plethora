/**
 * Selection entry intent tests (task 4.1).
 */

import { describe, expect, it } from "vitest";
import {
  buildSelectionEntryIntent,
  HandoffAcknowledgments,
  selectionThreadDecision,
} from "../selectionIntent";
import { buildLiveSnapshotDraft } from "../conversations/importLegacy";

const OWNER = "local:device-a";

function intent(overrides: Partial<Parameters<typeof buildSelectionEntryIntent>[0]["request"]> = {}) {
  return buildSelectionEntryIntent({
    ownerProfileId: OWNER,
    surface: "queue-selection",
    request: {
      selectedText: "The captured passage about grounding.",
      documentId: "doc-1",
      documentTitle: "Paper One",
      locator: { page: 12, quote: "The captured passage about grounding." },
      action: "ask",
      ...overrides,
    },
  });
}

describe("buildSelectionEntryIntent", () => {
  it("captures the exact passage and locator before the selection disappears", () => {
    const entry = intent();
    expect(entry.selectionSnapshot.originalText).toBe("The captured passage about grounding.");
    expect(entry.selectionSnapshot.locator).toEqual({
      page: 12,
      quote: "The captured passage about grounding.",
    });
    expect(entry.sourceAttachments[0]).toMatchObject({
      kind: "selection",
      libraryId: "doc-1",
      role: "required",
    });
  });

  it("defaults to passage-scope and widens visibly for Ask my library", () => {
    expect(intent().restriction.mode).toBe("document");
    expect(intent({ action: "ask-library" }).restriction.mode).toBe("library");
    expect(intent({ action: "ask-library" }).sourceAttachments[0].role).toBe("optional");
  });

  it("is deterministic per passage/source/action", () => {
    expect(intent().handoffId).toBe(intent().handoffId);
    expect(intent().handoffId).not.toBe(intent({ action: "explain" }).handoffId);
    expect(intent().handoffId).not.toBe(intent({ selectedText: "Another passage" }).handoffId);
    expect(intent().handoffId).not.toBe(
      buildSelectionEntryIntent({
        ownerProfileId: "local:device-b",
        surface: "queue-selection",
        request: { selectedText: "The captured passage about grounding.", documentId: "doc-1", action: "ask" },
      }).handoffId,
    );
  });

  it("carries ephemeral identity without fabricating a library id", () => {
    const entry = intent({
      documentId: undefined,
      documentTitle: "Unsaved article",
      ephemeral: { ownerToken: "viewer:article", sourceType: "web", localOnly: true },
    });
    expect(entry.sourceAttachments[0].libraryId).toBeUndefined();
    expect(entry.sourceAttachments[0].ephemeral?.localOnly).toBe(true);
  });

  it("feeds the live-snapshot capture path with the same provenance", () => {
    const entry = intent();
    const draft = buildLiveSnapshotDraft(OWNER, {
      surface: "ask-sheet",
      question: "Why does this matter?",
      answer: "Because the argument depends on it.",
      selectionText: entry.selectionSnapshot.originalText,
      documentId: entry.selectionSnapshot.documentId,
      title: entry.selectionSnapshot.title,
    });
    expect(draft.selection?.originalText).toBe("The captured passage about grounding.");
    expect(draft.deviceLocal).toBe(true);
  });
});

describe("selectionThreadDecision", () => {
  it("reopens the same handoff and starts a new thread for a different selection", () => {
    const first = intent();
    const same = intent();
    const different = intent({ selectedText: "A genuinely different passage." });
    expect(
      selectionThreadDecision({
        intent: same,
        currentHandoffId: first.handoffId,
        currentHasMessages: true,
      }).reuseCurrent,
    ).toBe(true);
    expect(
      selectionThreadDecision({
        intent: different,
        currentHandoffId: first.handoffId,
        currentHasMessages: true,
      }),
    ).toEqual({ reuseCurrent: false, reason: "a different selection prepares its own thread" });
  });

  it("an empty prepared thread is reused (distinct-new-selection preservation)", () => {
    expect(
      selectionThreadDecision({
        intent: intent({ selectedText: "New passage" }),
        currentHandoffId: "other",
        currentHasMessages: false,
      }).reuseCurrent,
    ).toBe(true);
  });

  it("an explicit add-to-conversation reseeds deliberately", () => {
    expect(
      selectionThreadDecision({
        intent: intent({ selectedText: "New passage" }),
        currentHandoffId: "other",
        currentHasMessages: true,
        explicitAddToConversation: true,
      }).reuseCurrent,
    ).toBe(true);
  });
});

describe("HandoffAcknowledgments", () => {
  it("delivers a handoff exactly once, even when the entry mounts twice", () => {
    const acks = new HandoffAcknowledgments();
    expect(acks.acknowledge("h1")).toBe(true);
    expect(acks.acknowledge("h1")).toBe(false);
    expect(acks.isAcknowledged("h1")).toBe(true);
  });

  it("reopening a dismissed handoff releases it once without resurrecting a newer one", () => {
    const acks = new HandoffAcknowledgments();
    acks.acknowledge("h1");
    acks.release("h1");
    expect(acks.acknowledge("h1")).toBe(true);
    // A newer handoff still delivers while the older is acknowledged.
    expect(acks.acknowledge("h2")).toBe(true);
  });
});
