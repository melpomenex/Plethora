import { describe, expect, it, beforeEach } from "vitest";
import { useLibraryAskHandoffStore } from "../libraryAskHandoff";

describe("library ask handoff", () => {
  beforeEach(() => {
    useLibraryAskHandoffStore.getState().consumeAsk();
  });

  it("carries the question and optional document context", () => {
    useLibraryAskHandoffStore.getState().requestAsk({
      question: "Summarize the key arguments in The-Doctrine-of-Fascism",
      documentId: "doc-1",
    });
    const pending = useLibraryAskHandoffStore.getState().pending;
    expect(pending).toMatchObject({
      question: "Summarize the key arguments in The-Doctrine-of-Fascism",
      documentId: "doc-1",
    });
    expect(pending?.nonce).toBeGreaterThan(0);
  });

  it("distinguishes two identical handoffs by nonce", () => {
    const { requestAsk } = useLibraryAskHandoffStore.getState();
    requestAsk({ question: "Same question" });
    const first = useLibraryAskHandoffStore.getState().pending?.nonce;
    requestAsk({ question: "Same question" });
    const second = useLibraryAskHandoffStore.getState().pending?.nonce;
    expect(second).not.toBe(first);
  });

  it("is consumed exactly once by the host", () => {
    useLibraryAskHandoffStore.getState().requestAsk({ question: "Q" });
    useLibraryAskHandoffStore.getState().consumeAsk();
    expect(useLibraryAskHandoffStore.getState().pending).toBeNull();
    // A second consume is a no-op, not an error.
    useLibraryAskHandoffStore.getState().consumeAsk();
    expect(useLibraryAskHandoffStore.getState().pending).toBeNull();
  });
});
