/**
 * Palette handoff tests (task 5.2).
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCompareDocumentsHandoff,
  handoffToEntryIntent,
  useLibraryAskHandoffStore,
} from "../libraryAskHandoff";

beforeEach(() => {
  useLibraryAskHandoffStore.setState({ pending: null });
});

describe("libraryAskHandoff", () => {
  it("bare open prepares an empty conversation without a question", () => {
    useLibraryAskHandoffStore.getState().requestOpen();
    const pending = useLibraryAskHandoffStore.getState().pending!;
    expect(pending.intent).toBe("open");
    expect(pending.question).toBe("");
    const intent = handoffToEntryIntent(pending);
    expect(intent.kind).toBe("open");
    expect(intent.question).toBeUndefined();
  });

  it("a full prefill carries the complete editable question and typed sources", () => {
    useLibraryAskHandoffStore.getState().requestAsk({
      question: "What does this paper argue?",
      documentId: "doc-1",
      contextPassage: "captured passage",
      sourceAttachments: [{
        attachmentId: "att-1",
        kind: "document",
        libraryId: "doc-1",
        title: "Paper",
        origin: "picker",
        role: "required",
      }],
      restriction: { mode: "document", origin: "entry", allowedDocumentIds: ["doc-1"] },
      selectionSnapshot: { originalText: "captured passage", documentId: "doc-1" },
    });
    const intent = handoffToEntryIntent(useLibraryAskHandoffStore.getState().pending!);
    expect(intent.kind).toBe("prefill");
    expect(intent.question).toBe("What does this paper argue?");
    expect(intent.sourceAttachments).toHaveLength(1);
    expect(intent.restriction?.allowedDocumentIds).toEqual(["doc-1"]);
    expect(intent.selectionSnapshot?.originalText).toBe("captured passage");
  });

  it("consume acknowledges exactly once even when a delayed mount runs twice", () => {
    useLibraryAskHandoffStore.getState().requestAsk({ question: "Q" });
    const first = useLibraryAskHandoffStore.getState().pending!;
    // Two mounts race; only the first consumes this nonce.
    useLibraryAskHandoffStore.getState().consumeAsk(first.nonce);
    expect(useLibraryAskHandoffStore.getState().pending).toBeNull();
    useLibraryAskHandoffStore.getState().consumeAsk(first.nonce);
    expect(useLibraryAskHandoffStore.getState().pending).toBeNull();
  });

  it("a newer intent is not consumed by an older acknowledgment", () => {
    useLibraryAskHandoffStore.getState().requestAsk({ question: "Old" });
    const older = useLibraryAskHandoffStore.getState().pending!;
    useLibraryAskHandoffStore.getState().requestAsk({ question: "New" });
    // The delayed mount acknowledges the OLD nonce: the new intent survives.
    useLibraryAskHandoffStore.getState().consumeAsk(older.nonce);
    expect(useLibraryAskHandoffStore.getState().pending?.question).toBe("New");
  });

  it("opening an existing conversation targets its id and return origin", () => {
    useLibraryAskHandoffStore.getState().requestConversation("conv-1", {
      surface: "palette-history",
      documentId: "doc-1",
    });
    const pending = useLibraryAskHandoffStore.getState().pending!;
    expect(pending.conversationId).toBe("conv-1");
    expect(pending.origin?.surface).toBe("palette-history");
    expect(handoffToEntryIntent(pending).conversationId).toBe("conv-1");
  });

  it("compare-two-documents keeps both real ids and no other source", () => {
    const handoff = buildCompareDocumentsHandoff({
      documents: [
        { id: "doc-a", title: "Paper A" },
        { id: "doc-b", title: "Paper B" },
      ],
    });
    expect(handoff.restriction?.allowedDocumentIds).toEqual(["doc-a", "doc-b"]);
    expect(handoff.sourceAttachments?.map((source) => source.libraryId)).toEqual(["doc-a", "doc-b"]);
    expect(handoff.question).toContain("Paper A");
    expect(handoff.question).toContain("Paper B");
    // Never auto-submits: the intent is a prefill.
    useLibraryAskHandoffStore.getState().requestAsk(handoff);
    expect(handoffToEntryIntent(useLibraryAskHandoffStore.getState().pending!).kind).toBe("prefill");
  });
});
