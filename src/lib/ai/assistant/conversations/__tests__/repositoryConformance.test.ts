/**
 * Repository conformance tests (tasks 1.3/1.4).
 *
 * These run against `ConversationRepositoryCore` over the shared memory
 * backend. The native path enforces the same observable contract in Rust
 * (`src-tauri/src/database/ai_conversation_repository.rs` tests assert
 * partition isolation, revision guarding, atomic append, superseded-attempt
 * rejection and tombstone wins), so both platform adapters agree:
 *
 *   memory backend (this file)  ≡  IndexedDB backend (same core, task 1.4)
 *   Rust repository (cargo)     ≡  native adapter (same commands, task 1.3)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { ConversationRepositoryCore, cryptoRandomId } from "../core";
import { MemoryConversationStore } from "../store";
import type { AppendTurnInput, ConversationRecord } from "../types";
import type { RepositoryResult } from "../repository";

const OWNER = "local:device-a";

/** Narrow a RepositoryResult error branch in tests. */
function expectErr<T>(result: RepositoryResult<T>): { code: string; message: string } {
  if (result.ok || !result.error) throw new Error('expected an error result');
  return result.error;
}
const OTHER_OWNER = "local:device-b";

const CONTEXT_POLICY = { mode: "auto", origin: "explicit" } as const;

/** Narrow a RepositoryResult in tests without non-null assertions. */
function expectOk<T>(result: RepositoryResult<T>): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function makeCore(): { core: ConversationRepositoryCore; store: MemoryConversationStore } {
  const store = new MemoryConversationStore();
  const core = new ConversationRepositoryCore(store, {
    nativeSync: false,
    durableTransactions: false,
    location: "device",
  });
  return { core, store };
}

function appendInput(conversationId: string, turnId: string): AppendTurnInput {
  const now = Date.now();
  return {
    conversationId,
    expectedRevision: 0,
    userMessage: {
      id: `${turnId}-user`,
      conversationId,
      turnId,
      role: "user",
      createdAt: now,
      orderKey: `0000000000000001:${turnId}-user`,
      content: "What does this passage mean?",
    },
    turn: {
      id: turnId,
      conversationId,
      userMessageId: `${turnId}-user`,
      requestPlan: {
        conversationId,
        turnId,
        question: "What does this passage mean?",
        mentionTokens: [],
        policy: { ...CONTEXT_POLICY },
        sources: [],
        provider: {
          configurationId: "cfg-1",
          kind: "cloud",
          model: "test-model",
          locality: "remote",
        },
        requestEpoch: 1,
      },
      status: "queued",
      attempts: [
        {
          id: `${turnId}-attempt-1`,
          turnId,
          requestPlan: {
            conversationId,
            turnId,
            question: "What does this passage mean?",
            mentionTokens: [],
            policy: { ...CONTEXT_POLICY },
            sources: [],
            provider: {
              configurationId: "cfg-1",
              kind: "cloud",
              model: "test-model",
              locality: "remote",
            },
            requestEpoch: 1,
          },
          status: "queued",
          startedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function createConversation(
  core: ConversationRepositoryCore,
  ownerProfileId: string,
  id: string,
  title = "Thread",
): Promise<ConversationRecord> {
  const created = await core.createConversation({
    id,
    ownerProfileId,
    title,
    contextPolicy: { ...CONTEXT_POLICY },
  });
  expect(created.ok).toBe(true);
  const record = await core.getConversation(ownerProfileId, id);
  expect(record.ok).toBe(true);
  return expectOk(record);
}

describe("conversation repository conformance", () => {
  let core: ConversationRepositoryCore;
  let store: MemoryConversationStore;

  beforeEach(() => {
    ({ core, store } = makeCore());
  });

  it("isolates partitions and refuses cross-partition id reuse", async () => {
    await createConversation(core, OWNER, "conv-1", "Mine");
    // Other partition cannot read it.
    const other = await core.getConversation(OTHER_OWNER, "conv-1");
    expect(other.ok).toBe(false);
    // Same id in another partition is refused, not silently shared.
    const crossPartition = await core.createConversation({
      id: "conv-1",
      ownerProfileId: OTHER_OWNER,
      title: "Theirs",
    });
    expect(crossPartition.ok).toBe(false);
    // The other partition keeps its own id space.
    await createConversation(core, OTHER_OWNER, "conv-2", "Theirs");
    const mine = await core.listConversations(OWNER);
    const theirs = await core.listConversations(OTHER_OWNER);
    expect(mine.items.map((c) => c.id)).toEqual(["conv-1"]);
    expect(theirs.items.map((c) => c.id)).toEqual(["conv-2"]);
  });

  it("guards every mutation with the expected revision", async () => {
    await createConversation(core, OWNER, "conv-1");
    const appended = await core.appendTurn(appendInput("conv-1", "t1"), {
      ownerProfileId: OWNER,
      expectedRevision: 0,
    });
    expect(appended.ok).toBe(true);
    // A stale revision must not write anything.
    const stale = await core.appendTurn(appendInput("conv-1", "t2"), {
      ownerProfileId: OWNER,
      expectedRevision: 0,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(expectErr(stale).code).toBe("revision_conflict");
    const record = await core.getConversation(OWNER, "conv-1");
    expect(expectOk(record).messages).toHaveLength(1);
    expect(expectOk(record).turns).toHaveLength(1);
  });

  it("appends the user turn atomically with its attempt and draft checkpoint", async () => {
    await createConversation(core, OWNER, "conv-1");
    const input = appendInput("conv-1", "t1");
    input.draftCheckpoint = {
      text: "",
      attachments: [],
      mentionTokens: [],
    };
    const appended = await core.appendTurn(input, { ownerProfileId: OWNER });
    expect(appended.ok).toBe(true);
    const record = await core.getConversation(OWNER, "conv-1");
    expect(expectOk(record).messages).toHaveLength(1);
    expect(expectOk(record).turns[0].status).toBe("queued");
    expect(expectOk(record).turns[0].attempts).toHaveLength(1);
    expect(expectOk(record).draft).toBeDefined();
  });

  it("records a finalized attempt and rejects a superseded late attempt", async () => {
    await createConversation(core, OWNER, "conv-1");
    await core.appendTurn(appendInput("conv-1", "t1"), { ownerProfileId: OWNER });
    const finalized = await core.finalizeAttempt(
      {
        conversationId: "conv-1",
        turnId: "t1",
        attemptId: "t1-attempt-1",
        status: "complete",
        assistantMessage: {
          id: "t1-assistant",
          conversationId: "conv-1",
          turnId: "t1",
          role: "assistant",
          createdAt: Date.now(),
          orderKey: "0000000000000002:t1-assistant",
          content: "The answer.",
          evidence: { origin: "model", level: "none", retrievalMode: "none", sourceFree: true },
          sourceSnapshot: [
            {
              attachmentId: "att-1",
              kind: "document",
              libraryId: "doc-1",
              title: "Doc",
              origin: "history",
              role: "optional",
            },
          ],
        },
      },
      { ownerProfileId: OWNER },
    );
    expect(finalized.ok).toBe(true);

    const late = await core.finalizeAttempt(
      {
        conversationId: "conv-1",
        turnId: "t1",
        attemptId: "t1-attempt-1",
        status: "complete",
        assistantMessage: {
          id: "t1-assistant-late",
          conversationId: "conv-1",
          turnId: "t1",
          role: "assistant",
          createdAt: Date.now(),
          orderKey: "0000000000000003:late",
          content: "Late duplicate.",
        },
      },
      { ownerProfileId: OWNER },
    );
    // Re-finalizing the SAME attempt is superseded once accepted.
    expect(late.ok).toBe(false);

    const record = await core.getConversation(OWNER, "conv-1");
    const assistant = expectOk(record).messages.filter((message) => message.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toBe("The answer.");
    expect(expectOk(record).turns[0].acceptedAttemptId).toBe("t1-attempt-1");
  });

  it("keeps tombstones authoritative over late writes and imports", async () => {
    await createConversation(core, OWNER, "conv-1");
    const deleted = await core.deleteConversation("conv-1", { ownerProfileId: OWNER });
    expect(deleted.ok).toBe(true);
    // Late append is refused.
    const blocked = await core.appendTurn(appendInput("conv-1", "t1"), {
      ownerProfileId: OWNER,
      expectedRevision: 1,
    });
    expect(blocked.ok).toBe(false);
    // A bundle that tries to resurrect it is skipped, not applied.
    const tombstoned = await core.getConversation(OWNER, "conv-1");
    const bundle = {
      formatVersion: 1 as const,
      exportedAt: Date.now(),
      conversations: [expectOk(tombstoned)],
    };
    const imported = await core.importConversations(OWNER, bundle);
    expect(imported.ok).toBe(true);
    expect(expectOk(imported).importedConversations).toBe(0);
    const stillDeleted = await core.getConversation(OWNER, "conv-1");
    expect(expectOk(stillDeleted).deletedAt).toBeGreaterThan(0);
  });

  it("reports a quota failure from a write without losing the prior record", async () => {
    await createConversation(core, OWNER, "conv-1");
    store.failWrites = new Error("QuotaExceededError: storage is full");
    const failed = await core.commitDraft(
      "conv-1",
      {
        conversationId: "conv-1",
        draft: {
          deviceId: "device-a",
          revision: 0,
          text: "unsaved text",
          attachments: [],
          mentionTokens: [],
          updatedAt: Date.now(),
        },
      },
      { ownerProfileId: OWNER },
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("quota_exceeded"); // narrowed above
    store.failWrites = null;
    // The previous durable record is intact (no partial overwrite).
    const record = await core.getConversation(OWNER, "conv-1");
    expect(record.ok).toBe(true);
    expect(expectOk(record).draft).toBeUndefined();
  });

  it("imports a bundle exactly once, resumable across a repeated run", async () => {
    const source = makeCore();
    await createConversation(source.core, OWNER, "conv-src", "Migrated thread");
    const appended = await source.core.appendTurn(appendInput("conv-src", "t-src"), {
      ownerProfileId: OWNER,
    });
    expect(appended.ok).toBe(true);
    const bundle = await source.core.exportConversations(OWNER);
    expect(bundle.ok).toBe(true);

    const first = await core.importConversations(OWNER, expectOk(bundle));
    expect(first.ok).toBe(true);
    expect(expectOk(first).importedConversations).toBe(1);
    expect(expectOk(first).importedMessages).toBe(1);

    // Re-running the same bundle imports nothing new (digest journal); the
    // cumulative count stays 1 and no duplicate messages appear.
    const second = await core.importConversations(OWNER, expectOk(bundle));
    expect(second.ok).toBe(true);
    expect(expectOk(second).importedConversations).toBe(0);
    const record = await core.getConversation(OWNER, "conv-src");
    expect(expectOk(record).messages).toHaveLength(1);

    // Crash-resume: a checkpoint in the middle of a three-record bundle.
    const big = {
      formatVersion: 1 as const,
      exportedAt: Date.now(),
      conversations: [expectOk(bundle).conversations[0], expectOk(bundle).conversations[0], expectOk(bundle).conversations[0]],
    };
    const resumed = await core.importConversations(OWNER, big, {
      cursor: "1",
      importedConversations: 1,
      importedMessages: 1,
      quarantined: 0,
    });
    expect(resumed.ok).toBe(true);
    // Records 1 and 2 are the same digest: nothing new imported.
    expect(expectOk(resumed).importedConversations).toBe(1);
  });

  it("quarantines malformed imported records and keeps them recoverable", async () => {
    const bad = {
      formatVersion: 1 as const,
      exportedAt: Date.now(),
      conversations: [
        { id: "", title: 42 },
        { id: "ok-1", ownerProfileId: OWNER, title: "Valid", createdAt: 1, updatedAt: 1, revision: 0, contextPolicy: { mode: "auto", origin: "explicit" }, activeAttachments: [], sourceHistory: [], syncPolicy: "device-local", legacyAliases: [], messages: [], turns: [] },
      ],
    } as never;
    const result = await core.importConversations(OWNER, bad);
    expect(result.ok).toBe(true);
    expect(expectOk(result).quarantined).toBe(1);
    const quarantined = await core.listQuarantined(OWNER);
    expect(quarantined.ok).toBe(true);
    expect(expectOk(quarantined)).toHaveLength(1);
    expect(expectOk(quarantined)[0].raw).toBeDefined();
    // The valid record still imported.
    const valid = await core.getConversation(OWNER, "ok-1");
    expect(valid.ok).toBe(true);
  });

  it("notifies subscribers for the owning partition only", async () => {
    await createConversation(core, OWNER, "conv-1");
    const seen: string[] = [];
    const unsubscribe = core.subscribe(OWNER, (change) => seen.push(change.conversationId));
    await core.appendTurn(appendInput("conv-1", "t1"), { ownerProfileId: OWNER });
    unsubscribe();
    await core.appendTurn(appendInput("conv-1", "t2"), { ownerProfileId: OWNER });
    expect(seen).toEqual(["conv-1"]);
    expect(store.keys().length).toBeGreaterThan(0);
  });

  it("generates ids without collisions", () => {
    const ids = new Set(Array.from({ length: 500 }, () => cryptoRandomId()));
    expect(ids.size).toBe(500);
  });
});
