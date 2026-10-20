import { describe, expect, it } from "vitest";
import {
  decodeAgentDraftArtifact,
  decodeConversationRecord,
  encodeConversationRecord,
} from "../serialize";
import { AGENT_DRAFT_ARTIFACT_VERSION, CONVERSATION_RECORD_VERSION } from "../types";

const legacyV2 = {
  version: CONVERSATION_RECORD_VERSION,
  id: "conv-old",
  ownerProfileId: "owner-1",
  title: "Old conversation",
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
  contextPolicy: { mode: "auto", origin: "explicit" },
  activeAttachments: [],
  sourceHistory: [],
  syncPolicy: "device-local",
  legacyAliases: [],
  messages: [
    {
      id: "m1",
      conversationId: "conv-old",
      turnId: "t1",
      role: "user",
      createdAt: 1,
      orderKey: "0001:m1",
      content: "Hello",
    },
  ],
  turns: [],
};

describe("conversation agent artifact", () => {
  it("hydrates an old v2 record unchanged when no artifact exists", () => {
    const result = decodeConversationRecord(legacyV2);
    expect(result.ok).toBe(true);
    expect(result.value?.agentDraft).toBeUndefined();
    expect(result.value?.messages).toHaveLength(1);
    expect(result.value?.messages[0].content).toBe("Hello");
  });

  it("round-trips draft content, source refs, statuses and saved ids only", () => {
    const record = {
      ...legacyV2,
      agentDraft: {
        version: AGENT_DRAFT_ARTIFACT_VERSION,
        runId: "run-1",
        conversationId: "conv-old",
        intent: "Cards from this section",
        scope: "section" as const,
        createdAt: 10,
        updatedAt: 11,
        sources: [
          {
            attachmentId: "doc:paper-a",
            kind: "document" as const,
            libraryId: "paper-a",
            title: "Paper A",
            contentVersion: "hash-a",
            origin: "active-view" as const,
            role: "required" as const,
          },
        ],
        selection: { originalText: "Selected text", documentId: "paper-a" },
        sectionTitle: "Chapter 1",
        partial: true,
        endReason: "cancelled",
        explanation: "Stopped by the user.",
        candidates: [
          {
            proposalId: "run-1:p1",
            kind: "flashcard" as const,
            sourceRefs: [
              {
                handle: "s1",
                refId: "chunk-a",
                kind: "chunk" as const,
                documentId: "paper-a",
                title: "Paper A",
                contentVersion: "hash-a",
              },
            ],
            question: "What is entropy?",
            answer: "Disorder.",
            cardType: "qa",
            conceptKeys: ["entropy"],
            status: "saved" as const,
            savedId: "item-1",
            provenancePending: true,
            issues: ["Saved; source metadata needs repair."],
          },
          {
            proposalId: "run-1:p2",
            kind: "cloze" as const,
            sourceRefs: [],
            question: "ATP is {{c1::energy}}.",
            answer: "energy",
            clozeText: "ATP is {{c1::energy}}.",
            status: "draft" as const,
          },
        ],
      },
    };
    const encoded = encodeConversationRecord(record as never);
    expect(encoded).not.toContain("AbortController");
    expect(encoded).not.toContain("ownerToken");
    expect(encoded).not.toContain("transcript");
    const decoded = decodeConversationRecord(JSON.parse(encoded));
    expect(decoded.ok).toBe(true);
    expect(decoded.value?.agentDraft?.runId).toBe("run-1");
    expect(decoded.value?.agentDraft?.candidates[0].status).toBe("saved");
    expect(decoded.value?.agentDraft?.candidates[0].savedId).toBe("item-1");
    expect(decoded.value?.agentDraft?.candidates[0].provenancePending).toBe(true);
    expect(decoded.value?.agentDraft?.candidates[1].clozeText).toBe("ATP is {{c1::energy}}.");
  });

  it("drops an unsupported artifact version instead of inventing execution", () => {
    expect(decodeAgentDraftArtifact({ ...legacyV2, version: 99 })).toBeNull();
    const result = decodeConversationRecord({
      ...legacyV2,
      agentDraft: { version: 99, runId: "run-x" },
    });
    expect(result.ok).toBe(true);
    expect(result.value?.agentDraft).toBeUndefined();
  });

  it("preserves an unknown record-level field through a round trip", () => {
    const decoded = decodeConversationRecord({ ...legacyV2, futureField: { a: 1 } });
    expect(decoded.ok).toBe(true);
    expect(decoded.value?.unknownFields?.futureField).toEqual({ a: 1 });
  });
});
