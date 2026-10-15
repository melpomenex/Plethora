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


describe("workspace entry intents", () => {
  it("opens without inventing a question and coalesces pending bare entries", () => {
    const store = useLibraryAskHandoffStore.getState();
    store.consumeAsk();
    store.requestOpen();
    const first = useLibraryAskHandoffStore.getState().pending;
    store.requestOpen();
    expect(first).toMatchObject({ intent: "open", question: "" });
    expect(useLibraryAskHandoffStore.getState().pending?.nonce).toBe(first?.nonce);
  });
  it("does not let an old acknowledgement erase a newer intent", () => {
    const store = useLibraryAskHandoffStore.getState();
    store.requestAsk({ question: "First" });
    const first = useLibraryAskHandoffStore.getState().pending!.nonce;
    store.requestAsk({ question: "Second", documentId: "doc-2" });
    store.consumeAsk(first);
    expect(useLibraryAskHandoffStore.getState().pending).toMatchObject({ intent: "prefill", question: "Second", documentId: "doc-2" });
    store.consumeAsk(useLibraryAskHandoffStore.getState().pending!.nonce);
    expect(useLibraryAskHandoffStore.getState().pending).toBeNull();
  });
});
