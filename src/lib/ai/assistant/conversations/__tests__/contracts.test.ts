/**
 * Contract and serialization tests for the canonical conversation records
 * (task 1.1). These verify the invariants the migration and repository layers
 * depend on:
 *  - unknown persisted payloads survive a decode/encode round trip;
 *  - decoding never invents citations, evidence or identities;
 *  - version-1 records upgrade with honest defaults;
 *  - malformed input is reported, never silently coerced into a record.
 */

import { describe, expect, it } from "vitest";
import {
  classifyStoredPayload,
  decodeConversationRecord,
  decodeDraft,
  encodeConversationRecord,
  upgradeConversationV1,
} from "../serialize";
import {
  CONVERSATION_RECORD_VERSION,
  isStrictPolicy,
  modelKnowledgeEvidence,
  toAssistantScope,
  unverifiedEvidence,
  type ConversationRecord,
  type Message,
} from "../types";

function baseRecord(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    version: CONVERSATION_RECORD_VERSION,
    id: "conv-1",
    ownerProfileId: "local:device-a",
    title: "Fixture conversation",
    createdAt: 1_780_000_000_000,
    updatedAt: 1_780_000_060_000,
    revision: 3,
    contextPolicy: { mode: "auto", origin: "inferred" },
    activeAttachments: [],
    sourceHistory: [],
    syncPolicy: "device-local",
    legacyAliases: ["sidebar:document:doc-1"],
    messages: [],
    turns: [],
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    turnId: "turn-1",
    role: "assistant",
    createdAt: 1_780_000_010_000,
    orderKey: "00017800000010000:msg-1",
    content: "Answer text",
    ...overrides,
  };
}

describe("conversation record versioning", () => {
  it("is self-consistent and deterministic across decode/encode cycles", () => {
    const record = baseRecord({
      messages: [assistantMessage({
        citations: [{
          id: "cite-1",
          displayNumber: 3,
          refId: "chunk-3",
          quote: "validated quote",
          documentId: "doc-1",
          origin: "library",
          validation: "verified",
          locator: { page: 12 },
        }],
        evidence: {
          origin: "library",
          level: "supported",
          retrievalMode: "semantic",
          coverage: { suppliedCount: 4, citedCount: 1 },
        },
      })],
    });
    // Persisted bytes reach a fixed point after one normalization pass; from
    // then on decode∘encode is the identity.
    const first = encodeConversationRecord(decodeConversationRecord(record).value!);
    const second = encodeConversationRecord(decodeConversationRecord(JSON.parse(first)).value!);
    const third = encodeConversationRecord(decodeConversationRecord(JSON.parse(second)).value!);
    expect(second).toBe(first);
    expect(third).toBe(first);
    const decoded = decodeConversationRecord(JSON.parse(first)).value!;
    expect(decoded.messages[0].citations![0].displayNumber).toBe(3);
    expect(decoded.messages[0].citations![0].chunkId).toBeUndefined();
  });

  it("classifies stored payloads without guessing", () => {
    expect(classifyStoredPayload(baseRecord())).toBe("v2");
    expect(classifyStoredPayload({ version: 1, id: "x", messages: [] })).toBe("v1");
    expect(classifyStoredPayload({ version: 1, id: "x", contextPolicy: { mode: "chat", origin: "explicit" } })).toBe("v1");
    expect(classifyStoredPayload({ some: "other-shape" })).toBe("unknown");
    expect(classifyStoredPayload(null)).toBe("unknown");
  });

  it("reports unusable records with a reason instead of throwing", () => {
    for (const raw of [null, 42, "text", [], {}]) {
      const result = decodeConversationRecord(raw);
      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    }
    expect(decodeConversationRecord({ id: "x" }).reason).toMatch(/ownerProfileId/);
    expect(decodeConversationRecord({ id: "x", ownerProfileId: "p" }).reason).toMatch(/title/);
  });
});

describe("unknown payload preservation", () => {
  it("preserves conversation-level unknown fields across a round trip", () => {
    const raw = {
      ...baseRecord(),
      experimentFlag: { variant: "b", rollout: 3 },
      futureSyncCursor: "cursor-77",
    };
    const decoded = decodeConversationRecord(raw);
    expect(decoded.ok).toBe(true);
    expect(decoded.value!.unknownFields).toEqual({
      experimentFlag: { variant: "b", rollout: 3 },
      futureSyncCursor: "cursor-77",
    });
    // Preserved fields survive re-encoding.
    const encoded = JSON.parse(encodeConversationRecord(decoded.value!));
    expect(encoded.unknownFields.experimentFlag).toEqual({ variant: "b", rollout: 3 });
  });

  it("preserves message-level unknown fields verbatim in legacyPayload", () => {
    const rawMessage = {
      id: "m-legacy",
      role: "assistant",
      content: "Legacy answer with [3] marker",
      timestamp: 1_780_000_000_000,
      legacyFooter: "[3] Doc",
      clientBuild: "3.2.0",
    };
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      messages: [rawMessage],
    });
    expect(decoded.ok).toBe(true);
    const message = decoded.value!.messages[0];
    expect(message.legacyPayload).toEqual({ legacyFooter: "[3] Doc", clientBuild: "3.2.0" });
    expect(message.citations).toBeUndefined();
    expect(message.evidence).toBeUndefined();
  });

  it("keeps decoded attachments inactive so hydration never reattaches", () => {
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      activeAttachments: [{
        attachmentId: "att-1",
        kind: "document",
        libraryId: "doc-1",
        title: "Doc",
        origin: "picker",
        role: "optional",
        // `active` intentionally missing (legacy record)
      }],
    });
    expect(decoded.value!.activeAttachments[0].active).toBe(false);
  });

  it("fills order keys deterministically for records without one", () => {
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      messages: [
        { id: "b", role: "user", content: "second", timestamp: 2000, conversationId: "conv-1", turnId: "t" },
        { id: "a", role: "user", content: "first", timestamp: 1000, conversationId: "conv-1", turnId: "t" },
      ],
    });
    const keys = decoded.value!.messages.map((m) => m.orderKey);
    // Ordering derives from `createdAt`, not from array position or id.
    expect(keys[1] < keys[0]).toBe(true);
    expect(keys[0].endsWith(":b")).toBe(true);
    expect(keys[1].endsWith(":a")).toBe(true);
  });
});

describe("no fabricated evidence", () => {
  it("drops evidence with an unknown level rather than defaulting to supported", () => {
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      messages: [assistantMessage({
        evidence: { origin: "library", level: "certainly-true", retrievalMode: "semantic" },
      } as unknown as Partial<Message>)],
    });
    expect(decoded.value!.messages[0].evidence).toBeUndefined();
  });

  it("drops citations with unknown origins or validation states", () => {
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      messages: [assistantMessage({
        citations: [
          { id: "c1", displayNumber: 1, origin: "made-up", validation: "verified" },
          { id: "c2", displayNumber: 2, origin: "library", validation: "probably" },
          { id: "c3", displayNumber: 3, origin: "library", validation: "verified" },
        ],
      } as unknown as Partial<Message>)],
    });
    const citations = decoded.value!.messages[0].citations ?? [];
    expect(citations.map((c) => c.id)).toEqual(["c3"]);
  });

  it("modelKnowledgeEvidence never claims support", () => {
    const evidence = modelKnowledgeEvidence();
    expect(evidence.level).toBe("none");
    expect(evidence.sourceFree).toBe(true);
    expect(evidence.origin).toBe("model");
  });

  it("unverifiedEvidence marks imported content unverified", () => {
    expect(unverifiedEvidence("selection").level).toBe("unverified");
  });
});

describe("version-1 upgrade", () => {
  it("upgrades a v1 record with honest defaults and no invented citations", () => {
    const legacy = {
      version: 1,
      id: "old-conv",
      ownerProfileId: "local:device-a",
      title: "Old",
      createdAt: 1,
      updatedAt: 2,
      revision: 1,
      mode: "library",
      messages: [{ id: "m", role: "user", content: "q", timestamp: 3 }],
    };
    const result = upgradeConversationV1(legacy);
    expect(result.ok).toBe(true);
    const record = result.value!;
    expect(record.version).toBe(2);
    expect(record.contextPolicy).toEqual({ mode: "library", origin: "explicit" });
    expect(record.syncPolicy).toBe("device-local");
    expect(record.messages[0].citations).toBeUndefined();
    expect(record.messages[0].evidence).toBeUndefined();
  });

  it("rejects a v1 record with no usable identity", () => {
    expect(upgradeConversationV1({ version: 1 }).ok).toBe(false);
    expect(upgradeConversationV1("not-an-object").ok).toBe(false);
  });
});

describe("drafts", () => {
  it("decodes a full draft with selection original and edited text", () => {
    const draft = decodeDraft({
      conversationId: "conv-1",
      deviceId: "device-a",
      revision: 7,
      text: "follow-up question",
      attachments: [],
      mentionTokens: [{ token: "@Paper", kind: "document", id: "doc-2" }],
      selection: {
        originalText: "The original passage",
        editedText: "The user-edited paraphrase",
        documentId: "doc-1",
        locator: { page: 4 },
      },
      updatedAt: 42,
    });
    expect(draft).not.toBeNull();
    expect(draft!.selection!.originalText).toBe("The original passage");
    expect(draft!.selection!.editedText).toBe("The user-edited paraphrase");
  });

  it("rejects drafts without a device identity (cross-device LWW risk)", () => {
    expect(decodeDraft({ conversationId: "c", text: "x", updatedAt: 1 })).toBeNull();
  });
});

describe("policy helpers", () => {
  it("maps policies to engine scopes without adding a fourth mode", () => {
    expect(toAssistantScope({ mode: "auto", origin: "explicit" })).toBe("chat");
    expect(toAssistantScope({ mode: "document", origin: "explicit" })).toBe("document");
    expect(toAssistantScope({ mode: "library", origin: "explicit" })).toBe("library");
    expect(isStrictPolicy({ mode: "auto", origin: "inferred" })).toBe(false);
    expect(isStrictPolicy({ mode: "library", origin: "explicit" })).toBe(true);
  });

  it("keeps locators source-appropriate and survives partial input", () => {
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      sourceHistory: [{
        attachmentId: "att-pdf",
        kind: "document",
        libraryId: "doc-9",
        title: "A PDF",
        origin: "history",
        role: "optional",
        locator: { page: 12, quote: "supporting quote" },
      }, {
        attachmentId: "att-bad",
        kind: "document",
        title: "No identity",
        origin: "history",
        role: "optional",
      }],
    });
    const sources = decoded.value!.sourceHistory;
    expect(sources).toHaveLength(1);
    expect(sources[0].locator).toEqual({ page: 12, quote: "supporting quote" });
  });

  it("accepts ephemeral viewer sources but refuses fabricated library ids", () => {
    const decoded = decodeConversationRecord({
      ...baseRecord(),
      sourceHistory: [
        {
          attachmentId: "att-eph",
          kind: "web",
          title: "Unsaved article",
          origin: "active-view",
          role: "optional",
          ephemeral: { ownerToken: "token-1", sourceType: "web", localOnly: true },
        },
        {
          attachmentId: "att-fake",
          kind: "library",
          title: "No library id and no capability",
          origin: "history",
          role: "optional",
        },
      ],
    });
    const ids = decoded.value!.sourceHistory.map((s) => s.attachmentId);
    expect(ids).toEqual(["att-eph"]);
  });
});
