/**
 * Turn controller tests (task 1.7). Verify the identity guarantees the
 * design calls out: dispatch only after a durable acknowledgment, phase
 * events sourced from the executor, stop/retry with stable user-turn
 * identity, and late output never mutating a thread.
 */

import { describe, expect, it } from "vitest";
import { ConversationRepositoryCore, cryptoRandomId } from "../core";
import { MemoryConversationStore } from "../store";
import { TurnController, RepositoryDispatchError, findInterruptedTurns } from "../turnController";
import type { ConversationRepository, RepositoryResult } from "../repository";
import type { FrozenTurnPlan, Message } from "../types";

const OWNER = "local:device-a";

/** Narrow a RepositoryResult error branch in tests. */
function expectErr<T>(result: RepositoryResult<T>): { code: string; message: string } {
  if (result.ok || !result.error) throw new Error('expected an error result');
  return result.error;
}

/** Narrow a RepositoryResult in tests without non-null assertions. */
function expectOk<T>(result: RepositoryResult<T>): T {
  if (!result.ok || result.value === undefined) {
    throw new Error(`expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}


function setup(options?: {
  failWrites?: boolean;
}): {
  repository: ConversationRepository;
  controller: TurnController;
  store: MemoryConversationStore;
  conversationId: string;
} {
  const store = new MemoryConversationStore();
  const repository = new ConversationRepositoryCore(store, {
    nativeSync: false,
    durableTransactions: false,
    location: "device",
  });
  const controller = new TurnController({
    repository,
    ownerProfileId: OWNER,
    now: () => 1_800_000_000_000,
  });
  const conversationId = "conv-1";
  return { repository, controller, store, conversationId };
}

async function seedConversation(repository: ConversationRepository, conversationId: string) {
  await repository.createConversation({
    id: conversationId,
    ownerProfileId: OWNER,
    title: "Thread",
    contextPolicy: { mode: "auto", origin: "explicit" },
  });
}

function plan(conversationId: string, question = "Explain this page"): Omit<FrozenTurnPlan, "requestEpoch"> {
  return {
    conversationId,
    turnId: "assigned-by-controller",
    question,
    mentionTokens: [],
    policy: { mode: "auto", origin: "inferred" },
    sources: [],
    provider: {
      configurationId: "cfg-1",
      kind: "cloud",
      model: "test-model",
      locality: "remote",
    },
  };
}

function assistant(question: string, content: string): (ids: {
  conversationId: string;
  turnId: string;
}) => Message {
  return ({ conversationId, turnId }) => ({
    id: cryptoRandomId(),
    conversationId,
    turnId,
    role: "assistant",
    createdAt: 1_800_000_000_100,
    orderKey: "0000000000000002:assistant",
    content,
  });
}

describe("turn controller", () => {
  it("dispatches only after the durable append and finalizes a complete turn", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);

    const phases: string[] = [];
    let dispatchedAfterAppend = false;
    const result = await controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async ({ plan: frozen, emit }) => {
        void frozen;
        // The record must already contain the pending turn when the executor
        // runs: the acknowledgment is the gate for dispatch.
        const record = await repository.getConversation(OWNER, conversationId);
        dispatchedAfterAppend = record.ok && expectOk(record).turns.length === 1;
        emit({ kind: "phase", phase: "retrieving" });
        emit({ kind: "text-delta", textDelta: "partial" });
        return { assistantMessage: assistant(plan(conversationId).question, "Full answer")({ conversationId, turnId: "t" }) };
      },
      (event) => {
        if (event.phase) phases.push(event.phase);
      },
    );

    expect(dispatchedAfterAppend).toBe(true);
    expect(result.turn.status).toBe("complete");
    expect(result.acceptedMessage?.content).toBe("Full answer");
    expect(phases).toContain("resolving");
    expect(phases).toContain("retrieving");
    expect(phases).toContain("complete");

    const record = await repository.getConversation(OWNER, conversationId);
    expect(expectOk(record).messages).toHaveLength(2);
    expect(expectOk(record).turns[0].acceptedAttemptId).toBeTruthy();
  });

  it("refuses to dispatch when the repository rejects the append (quota)", async () => {
    const { repository, controller, conversationId, store } = setup();
    await seedConversation(repository, conversationId);
    store.failWrites = new Error("QuotaExceededError: full");

    let executed = false;
    await expect(
      controller.submit(
        { conversationId, expectedRevision: 0, plan: plan(conversationId) },
        async () => {
          executed = true;
          return {};
        },
      ),
    ).rejects.toBeInstanceOf(RepositoryDispatchError);
    expect(executed).toBe(false); // no request without a durable acknowledgment
  });

  it("stops a cancellable transport and records the cancelled attempt", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);

    const submission = controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async ({ signal }) =>
        new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    // Let the append + dispatch land, then stop.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.stop(conversationId);
    const result = await submission;
    expect(result.turn.status).toBe("cancelled");

    const record = await repository.getConversation(OWNER, conversationId);
    expect(expectOk(record).turns[0].attempts[0].status).toBe("cancelled");
    expect(expectOk(record).turns[0].acceptedAttemptId).toBeUndefined();
  });

  it("detaches honestly when the provider cannot cancel and ignores late output", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);

    let resolveExecutor: ((value: { assistantMessage: Message }) => void) | null = null;
    const submission = controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async () =>
        new Promise((resolve) => {
          resolveExecutor = resolve;
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await controller.stop(conversationId, { providerCanCancel: false });
    // Late completion arrives after the detach.
    resolveExecutor?.({
      assistantMessage: assistant("q", "Late output")({ conversationId, turnId: "t" }),
    });
    const result = await submission;
    // Late output is never accepted for the detached attempt.
    expect(result.turn.status).toBe("interrupted");

    const record = await repository.getConversation(OWNER, conversationId);
    const messages = expectOk(record).messages.filter((message) => message.role === "assistant");
    expect(messages).toHaveLength(0);
    const attempt = expectOk(record).turns[0].attempts[0];
    expect(attempt.status).toBe("cancelled");
    expect(attempt.detached).toBe(true);
  });

  it("retries under the same user turn with a new attempt and no duplicate messages", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);

    const first = await controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async () => ({ failureReason: "provider_error" as const }),
    );
    expect(first.turn.status).toBe("failed");
    const recordAfterFirst = await repository.getConversation(OWNER, conversationId);
    const userMessages = expectOk(recordAfterFirst).messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);

    const retried = await controller.retry(
      conversationId,
      { turnId: first.turn.id, plan: first.turn.requestPlan },
      async () => ({
        assistantMessage: assistant("q", "Retried answer")({ conversationId, turnId: first.turn.id }),
      }),
    );
    expect(retried.turn.status).toBe("complete");
    const record = await repository.getConversation(OWNER, conversationId);
    // Same single user message; two attempts; one accepted answer.
    expect(expectOk(record).messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(expectOk(record).turns).toHaveLength(1);
    expect(expectOk(record).turns[0].attempts).toHaveLength(2);
    expect(expectOk(record).turns[0].acceptedAttemptId).toBe(
      retried.turn.attempts[1].id,
    );
  });

  it("refuses a retry once an attempt was accepted", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);
    const first = await controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async () => ({
        assistantMessage: assistant("q", "Answer")({ conversationId, turnId: "t" }),
      }),
    );
    await expect(
      controller.retry(
        conversationId,
        { turnId: first.turn.id, plan: first.turn.requestPlan },
        async () => ({}),
      ),
    ).rejects.toBeInstanceOf(RepositoryDispatchError);
  });

  it("keeps concurrent conversations independent and enforces one active turn each", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);
    await repository.createConversation({
      id: "conv-2",
      ownerProfileId: OWNER,
      title: "Second",
    });

    let releaseFirst: (() => void) | null = null;
    const first = controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({ assistantMessage: assistant("q", "A")({ conversationId, turnId: "t" }) });
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A second turn on the same conversation is refused...
    await expect(
      controller.submit(
        { conversationId, expectedRevision: 1, plan: plan(conversationId) },
        async () => ({}),
      ),
    ).rejects.toThrow(/already active/);

    // ...but another conversation can proceed.
    const second = await controller.submit(
      { conversationId: "conv-2", expectedRevision: 0, plan: plan("conv-2") },
      async () => ({
        assistantMessage: assistant("q", "B")({ conversationId: "conv-2", turnId: "t2" }),
      }),
    );
    expect(second.turn.status).toBe("complete");
    releaseFirst?.();
    await first;
  });

  it("detachAll aborts in-flight work (account/view switch)", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);
    const submission = controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new Error("detached")));
        }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.detachAll();
    const result = await submission;
    expect(result.turn.status).toBe("interrupted");
    expect(controller.active).toHaveLength(0);
  });

  it("findInterruptedTurns reports unfinished attempts for process-death recovery", async () => {
    const { repository, controller, conversationId } = setup();
    await seedConversation(repository, conversationId);
    // Simulated process death: the executor never settles and no finalize
    // happens, so the durable attempt stays `queued`.
    const submission = controller.submit(
      { conversationId, expectedRevision: 0, plan: plan(conversationId) },
      async () => new Promise(() => {}),
    );
    submission.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const record = await repository.getConversation(OWNER, conversationId);
    const interrupted = findInterruptedTurns(expectOk(record));
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].status).toBe("queued");
    // The attempt remains durably unfinished: recovery is explicit Retry, not
    // an automatic resume. (Do not await the dead executor promise.)
    expect(expectOk(record).turns[0].acceptedAttemptId).toBeUndefined();
  });
});
