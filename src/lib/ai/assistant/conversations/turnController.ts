/**
 * Canonical turn controller (design D5, task 1.7).
 *
 * Owns the submit → append → dispatch → finalize lifecycle and every identity
 * guard the design requires. Initially exercised behind the
 * `assistantCanonicalConversations` flag by its callers; the controller itself
 * has no UI knowledge.
 *
 * Guarantees implemented here:
 *  - a request is dispatched only after the repository acknowledges the atomic
 *    user-message + pending-turn append;
 *  - every progress/reply/effect result is matched against
 *    `(profileId, conversationId, turnId, attemptId, requestEpoch)` before it
 *    may touch state, so a source/account/view switch or a reset can never
 *    redirect or resurrect a reply;
 *  - Stop aborts through the executor's `AbortSignal` when supported and
 *    otherwise detaches with an honest reason;
 *  - Retry reuses the same user turn with a new attempt id and never replays a
 *    completed side effect;
 *  - one active attempt per conversation; independent conversations may run
 *    concurrently.
 */

import { modelKnowledgeEvidence, type Attempt, type FrozenTurnPlan, type Message, type Turn } from "./types";
import type {
  ConversationRepository,
  RepositoryMutationContext,
  RepositoryResult,
} from "./repository";
import { cryptoRandomId } from "./core";
import type { ConversationRecord } from "./types";

export type TurnPhase =
  | "queued"
  | "resolving"
  | "retrieving"
  | "preparing"
  | "generating"
  | "validating"
  | "complete"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface TurnRuntimeEvent {
  conversationId: string;
  turnId: string;
  attemptId: string;
  requestEpoch: number;
  kind: "phase" | "text-delta" | "evidence" | "tool" | "done" | "error";
  phase?: TurnPhase;
  textDelta?: string;
  detail?: string;
}

export interface TurnExecutorResult {
  assistantMessage?: Message;
  failureReason?: Attempt["failureReason"];
  /** Provider could not abort; output was detached rather than cancelled. */
  detached?: boolean;
  provider?: Attempt["provider"];
}

export interface TurnExecutor {
  (options: {
    plan: FrozenTurnPlan;
    signal: AbortSignal;
    emit: (event: Omit<TurnRuntimeEvent, "conversationId" | "turnId" | "attemptId" | "requestEpoch">) => void;
  }): Promise<TurnExecutorResult>;
}

export interface ActiveTurn {
  conversationId: string;
  turnId: string;
  attemptId: string;
  requestEpoch: number;
  /** Ids of the user message/turn appended and acknowledged. */
  userMessageId: string;
  abort: AbortController | null;
  /** True when Stop was pressed or the transport could not abort. */
  stopped: boolean;
}

export interface SubmitOptions {
  conversationId: string;
  expectedRevision: number;
  plan: Omit<FrozenTurnPlan, "requestEpoch">;
  /** Order key for the user message; defaults to now-based key. */
  userOrderKey?: string;
}

export interface TurnControllerOptions {
  repository: ConversationRepository;
  ownerProfileId: string;
  /** Injected clock for deterministic tests. */
  now?: () => number;
  /** Per-conversation view guard: only matching ids receive view effects. */
  isViewAttached?: (conversationId: string) => boolean;
}

export class TurnController {
  private activeByConversation = new Map<string, ActiveTurn>();
  private epochCounter = 0;
  private now: () => number;

  constructor(private options: TurnControllerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  get active(): ActiveTurn[] {
    return [...this.activeByConversation.values()];
  }

  activeFor(conversationId: string): ActiveTurn | undefined {
    return this.activeByConversation.get(conversationId);
  }

  /**
   * Submit a turn. Resolves after finalization (or failure); the promise
   * rejects only for repository-level failures (e.g. quota) because those
   * must keep the draft editable instead of pretending a request started.
   */
  async submit(
    options: SubmitOptions,
    executor: TurnExecutor,
    onEvent?: (event: TurnRuntimeEvent) => void,
  ): Promise<{ turn: Turn; acceptedMessage?: Message }> {
    const { conversationId } = options;
    if (this.activeByConversation.has(conversationId)) {
      throw new Error("a turn is already active for this conversation");
    }
    const now = this.now();
    const requestEpoch = ++this.epochCounter;
    const turnId = cryptoRandomId();
    const attemptId = cryptoRandomId();
    const userMessageId = cryptoRandomId();
    const userOrderKey = options.userOrderKey ?? `${now.toString().padStart(16, "0")}:${userMessageId}`;
    const fullPlan: FrozenTurnPlan = { ...options.plan, requestEpoch };

    const userMessage: Message = {
      id: userMessageId,
      conversationId,
      turnId,
      role: "user",
      createdAt: now,
      orderKey: userOrderKey,
      content: fullPlan.question,
    };
    const turn: Turn = {
      id: turnId,
      conversationId,
      userMessageId,
      requestPlan: fullPlan,
      status: "queued",
      attempts: [
        {
          id: attemptId,
          turnId,
          requestPlan: fullPlan,
          status: "queued",
          startedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    // 1. Durable acknowledgment BEFORE dispatch (design D5 step 1).
    const context: RepositoryMutationContext = {
      ownerProfileId: this.options.ownerProfileId,
      expectedRevision: options.expectedRevision,
    };
    const appended = await this.options.repository
      .appendTurn(
        {
          conversationId,
          expectedRevision: options.expectedRevision,
          userMessage,
          turn,
        },
        context,
      )
      .catch((error: unknown): RepositoryResult<{ turn: Turn; userMessage: Message }> => ({
        ok: false,
        error: {
          code: "storage_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    if (!appended.ok) {
      throw new RepositoryDispatchError(appended.error?.code ?? "storage_unavailable", appended.error?.message ?? "append failed");
    }

    const abort = new AbortController();
    const active: ActiveTurn = {
      conversationId,
      turnId,
      attemptId,
      requestEpoch,
      userMessageId,
      abort,
      stopped: false,
    };
    this.activeByConversation.set(conversationId, active);

    const emit = (event: Omit<TurnRuntimeEvent, "conversationId" | "turnId" | "attemptId" | "requestEpoch">) => {
      // Identity guard: events are only delivered while this exact attempt
      // owns the conversation slot.
      const current = this.activeByConversation.get(conversationId);
      if (
        !current ||
        current.turnId !== turnId ||
        current.attemptId !== attemptId ||
        current.requestEpoch !== requestEpoch
      ) {
        return;
      }
      onEvent?.({
        ...event,
        conversationId,
        turnId,
        attemptId,
        requestEpoch,
      });
    };

    try {
      emit({ kind: "phase", phase: "resolving" });
      const result = await executor({ plan: fullPlan, signal: abort.signal, emit });
      return await this.finalize(turnId, attemptId, result, onEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureReason: Attempt["failureReason"] = abort.signal.aborted
        ? "cancelled"
        : "provider_error";
      const finalized = await this.finalize(
        turnId,
        attemptId,
        { failureReason, detached: abort.signal.aborted ? undefined : true },
        onEvent,
        message,
      );
      return finalized;
    }
  }

  /**
   * Stop the active turn. Aborts through the executor signal; when the
   * provider cannot abort, the attempt is marked detached with an honest
   * reason and late output is ignored by the identity guard.
   */
  async stop(conversationId: string, opts?: { providerCanCancel?: boolean }): Promise<void> {
    const active = this.activeByConversation.get(conversationId);
    if (!active) return;
    active.stopped = true;
    const providerCanCancel = opts?.providerCanCancel ?? true;
    if (providerCanCancel) {
      active.abort?.abort();
      return;
    }
    // Provider cannot cancel: detach with accurate status, keep no listener.
    active.abort = null;
    await this.finalize(
      active.turnId,
      active.attemptId,
      { failureReason: "cancelled", detached: true },
      undefined,
      "stopped displaying; provider may still finish",
    );
  }

  /**
   * Retry a turn: reuse the same user turn, append a new attempt, and require
   * the caller to revalidate the plan (the design never pretends the same
   * evidence was used after a source/provider change).
   */
  async retry(
    conversationId: string,
    prev: { turnId: string; plan: FrozenTurnPlan },
    executor: TurnExecutor,
    onEvent?: (event: TurnRuntimeEvent) => void,
  ): Promise<{ turn: Turn; acceptedMessage?: Message }> {
    if (this.activeByConversation.has(conversationId)) {
      throw new Error("a turn is already active for this conversation");
    }
    const now = this.now();
    const requestEpoch = ++this.epochCounter;
    const turnId = prev.turnId;
    const attemptId = cryptoRandomId();
    const fullPlan: FrozenTurnPlan = { ...prev.plan, requestEpoch };

    const context: RepositoryMutationContext = { ownerProfileId: this.options.ownerProfileId };
    const attempt: Attempt = {
      id: attemptId,
      turnId,
      requestPlan: fullPlan,
      status: "queued",
      startedAt: now,
    };
    const appended = await this.options.repository
      .appendAttempt(
        { conversationId, turnId, attempt },
        context,
      )
      .catch((error: unknown): RepositoryResult<{ turn: Turn }> => ({
        ok: false,
        error: {
          code: "storage_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    if (!appended.ok) {
      throw new RepositoryDispatchError(appended.error?.code ?? "storage_unavailable", appended.error?.message ?? "append failed");
    }

    const aborted = new AbortController();
    const active: ActiveTurn = {
      conversationId,
      turnId,
      attemptId,
      requestEpoch,
      userMessageId: appended.value.turn.userMessageId,
      abort: aborted,
      stopped: false,
    };
    this.activeByConversation.set(conversationId, active);
    const emit = (event: Omit<TurnRuntimeEvent, "conversationId" | "turnId" | "attemptId" | "requestEpoch">) => {
      const current = this.activeByConversation.get(conversationId);
      if (
        !current ||
        current.turnId !== turnId ||
        current.attemptId !== attemptId ||
        current.requestEpoch !== requestEpoch
      ) {
        return;
      }
      onEvent?.({ ...event, conversationId, turnId, attemptId, requestEpoch });
    };
    try {
      const result = await executor({ plan: fullPlan, signal: aborted.signal, emit });
      return await this.finalize(turnId, attemptId, result, onEvent);
    } catch (error) {
      return this.finalize(
        turnId,
        attemptId,
        { failureReason: aborted.signal.aborted ? "cancelled" : "provider_error" },
        onEvent,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Detach everything (account switch / view teardown). */
  detachAll(): void {
    for (const active of this.activeByConversation.values()) {
      active.stopped = true;
      active.abort?.abort();
    }
    this.activeByConversation.clear();
  }

  private async finalize(
    turnId: string,
    attemptId: string,
    result: TurnExecutorResult,
    onEvent?: (event: TurnRuntimeEvent) => void,
    errorDetail?: string,
  ): Promise<{ turn: Turn; acceptedMessage?: Message }> {
    const active = [...this.activeByConversation.values()].find(
      (candidate) => candidate.turnId === turnId && candidate.attemptId === attemptId,
    );
    if (!active) {
      // The attempt was already finalized (detached stop) or its slot was
      // taken over by another conversation state: late output is ignored and
      // never touches views, tools or accepted results.
      return { turn: this.buildSyntheticTurn(turnId, attemptId, "interrupted") };
    }

    const status: Turn["status"] = result.assistantMessage
      ? "complete"
      : result.failureReason === "cancelled"
        ? "cancelled"
        : "failed";
    const context: RepositoryMutationContext = { ownerProfileId: this.options.ownerProfileId };
    const finalized = await this.options.repository.finalizeAttempt(
      {
        conversationId: active.conversationId,
        turnId,
        attemptId,
        status,
        assistantMessage: result.assistantMessage,
        failureReason: result.failureReason,
        detached: result.detached,
        provider: result.provider,
      },
      context,
    );
    this.activeByConversation.delete(active.conversationId);
    if (!finalized.ok) {
      if (finalized.error?.code === "invalid_input") {
        // Superseded by an accepted attempt: the late result is intentionally
        // dropped. Report the interrupted state, not success.
        return { turn: this.buildSyntheticTurn(turnId, attemptId, "interrupted") };
      }
      throw new RepositoryDispatchError(finalized.error?.code ?? "storage_unavailable", finalized.error?.message ?? "finalize failed");
    }
    if (errorDetail) {
      onEvent?.({
        conversationId: active.conversationId,
        turnId,
        attemptId,
        requestEpoch: active.requestEpoch,
        kind: "error",
        detail: errorDetail,
      });
    }
    onEvent?.({
      conversationId: active.conversationId,
      turnId,
      attemptId,
      requestEpoch: active.requestEpoch,
      kind: "done",
      phase: status,
    });
    return { turn: finalized.value.turn, acceptedMessage: finalized.value.assistantMessage };
  }

  private buildSyntheticTurn(turnId: string, attemptId: string, status: Turn["status"]): Turn {
    const now = this.now();
    const plan: FrozenTurnPlan = {
      conversationId: "",
      turnId,
      question: "",
      mentionTokens: [],
      policy: { mode: "auto", origin: "explicit" },
      sources: [],
      provider: { configurationId: "unassigned", kind: "unassigned", model: "unassigned", locality: "on-device" },
      requestEpoch: 0,
    };
    return {
      id: turnId,
      conversationId: "",
      userMessageId: "",
      requestPlan: plan,
      status,
      attempts: [],
      createdAt: now,
      updatedAt: now,
    };
  }
}

/** Thrown when the repository refuses the dispatch (draft must stay editable). */
export class RepositoryDispatchError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryDispatchError";
  }
}

/** Convenience: a no-evidence assistant message for model-knowledge answers. */
export function buildAssistantMessage(options: {
  conversationId: string;
  turnId: string;
  content: string;
  id?: string;
  orderKey?: string;
  now?: () => number;
}): Message {
  const now = (options.now ?? (() => Date.now()))();
  const id = options.id ?? cryptoRandomId();
  return {
    id,
    conversationId: options.conversationId,
    turnId: options.turnId,
    role: "assistant",
    createdAt: now,
    orderKey: options.orderKey ?? `${now.toString().padStart(16, "0")}:${id}`,
    content: options.content,
    evidence: modelKnowledgeEvidence(),
  };
}

/** True when a project record has an unfinished attempt (process-death recovery). */
export function findInterruptedTurns(record: ConversationRecord): Turn[] {
  return record.turns.filter(
    (turn) =>
      !turn.acceptedAttemptId &&
      (turn.status === "queued" ||
        turn.status === "resolving" ||
        turn.status === "retrieving" ||
        turn.status === "preparing" ||
        turn.status === "generating" ||
        turn.status === "validating"),
  );
}
