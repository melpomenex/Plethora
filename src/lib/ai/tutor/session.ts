/**
 * `TutorSession` — the Socratic tutoring state machine (design D24, task 7.2).
 *
 * Division of labor:
 *   - The MODEL (via `tutorTask`) chooses the move, sets `stuckDetected`, and
 *     may emit `promoteToCard`. Nothing here grades answers.
 *   - THIS state machine owns every bound and override. `enforceTutorPolicy`
 *     is a pure function applied to every model turn:
 *
 *     | # | Condition (checked in order)                   | Enforcement                        |
 *     |---|------------------------------------------------|------------------------------------|
 *     | 1 | session already ended                          | submit throws                      |
 *     | 2 | escape hatch armed ("just explain it")         | move → explain, instantly          |
 *     | 3 | tutor-turn cap reached (24th turn)             | move → wrap-up (session ends)      |
 *     | 4 | 3rd consecutive hint in a stuck thread         | move → explain (no endless hints)  |
 *     | 5 | model asks another question after 2 stuck      | move → hint (no endless questions) |
 *     |   | signals in a row                               |                                    |
 *     | 6 | hint accepted                                  | hintLevel = max(model, prev+1, 1), |
 *     |   |                                                | monotonic per thread, ≤ 3          |
 *     | 7 | any non-hint move                              | hint thread resets                 |
 *     | 8 | explain / wrap-up delivered help               | stuck counter resets               |
 *
 *   - Context stays bounded (`context.ts`): last 6 turns verbatim + a capped
 *     distilled summary; retrieved prerequisite context comes from
 *     `retrieveFromLibrary(topic, k≈3)` and is refreshed ONLY when the topic
 *     drifts (dominant key term of the learner's answer leaves the retrieval
 *     signature), at most 2 refreshes per session.
 */

import {
  MAX_HINT_LEVEL,
  type TutorCardPromotion,
  type TutorMove,
  type TutorTurn,
} from "../schemas/tutorTurn";
import type { AIProvider } from "../providers/types";
import type { AITaskResult, AITaskRunOptions } from "../tasks/types";
import {
  runTutorTurn,
  type TutorConversationEntry,
  type TutorTurnTaskInput,
} from "../tasks/definitions/tutorTask";
import { retrieveFromLibrary, type RetrievalResponse } from "../../../api/ai-learning";
import {
  TUTOR_CHUNK_MAX_CHARS,
  TUTOR_MATERIAL_MAX_CHARS,
  TUTOR_MAX_RETRIEVAL_REFRESHES,
  TUTOR_MAX_SESSION_TURNS,
  TUTOR_RETRIEVAL_K,
  buildTutorContext,
  capText,
  detectTopicDrift,
  topicSignature,
} from "./context";

// ──────────────────────────────────────────────────────────────────────────
// Policy (pure)
// ──────────────────────────────────────────────────────────────────────────

export interface TutorHintThread {
  /** Strength of the last hint in the current stuck thread (monotonic). */
  level: number;
  /** Consecutive tutor turns that were hints (thread-local). */
  consecutiveHints: number;
}

export interface TutorPolicyState {
  /** Consecutive tutor turns reporting the learner stuck. */
  stuckCounter: number;
  hintThread: TutorHintThread;
  /** Escape hatch armed: the next turn is a forced explain. */
  forcedExplain: boolean;
  /** Tutor turns emitted so far (opening turn included). */
  tutorTurnCount: number;
  /** True once a wrap-up turn was emitted. */
  ended: boolean;
}

export interface TutorPolicyLimits {
  /** Max consecutive hints per stuck thread before a forced explain. */
  maxConsecutiveHints: number;
  /** Max tutor turns per session before a forced wrap-up. */
  maxSessionTurns: number;
  /** Max hint strength (schema: 0–3). */
  maxHintLevel: number;
}

export const DEFAULT_TUTOR_LIMITS: TutorPolicyLimits = {
  maxConsecutiveHints: 2,
  maxSessionTurns: TUTOR_MAX_SESSION_TURNS,
  maxHintLevel: MAX_HINT_LEVEL,
};

/** Overrides the state machine applied to the model's turn (UI + tests). */
export type TutorPolicyOverride =
  | "escape-hatch-explain"
  | "turn-cap-wrap-up"
  | "hint-cap-explain"
  | "stuck-question-hint"
  | "hint-level-raised";

export interface TutorPolicyResult {
  /** The turn that is actually emitted (bounds enforced). */
  turn: TutorTurn;
  /** Which overrides fired, in order. */
  overrides: TutorPolicyOverride[];
  /** The next policy state. */
  state: TutorPolicyState;
}

export function initialTutorPolicyState(): TutorPolicyState {
  return {
    stuckCounter: 0,
    hintThread: { level: 0, consecutiveHints: 0 },
    forcedExplain: false,
    tutorTurnCount: 0,
    ended: false,
  };
}

/**
 * Enforce the session bounds on one model turn (pure). See the policy table
 * in the module doc. The model's `content` is always preserved — overrides
 * change the move (and therefore how the UI styles the turn), never the text.
 */
export function enforceTutorPolicy(
  modelTurn: TutorTurn,
  state: TutorPolicyState,
  limits: TutorPolicyLimits = DEFAULT_TUTOR_LIMITS
): TutorPolicyResult {
  if (state.ended) {
    throw new Error("The tutoring session has already ended.");
  }

  const overrides: TutorPolicyOverride[] = [];
  let move = modelTurn.move;
  let stuckDetected = modelTurn.stuckDetected;

  // 2. Escape hatch: honored instantly, regardless of what the model chose.
  if (state.forcedExplain) {
    if (move !== "explain") overrides.push("escape-hatch-explain");
    move = "explain";
    stuckDetected = true;
  }

  if (state.tutorTurnCount + 1 >= limits.maxSessionTurns) {
    // 3. Session-length cap: this turn closes the session no matter what.
    if (move !== "wrap-up") overrides.push("turn-cap-wrap-up");
    move = "wrap-up";
  } else if (
    move === "hint" &&
    state.hintThread.consecutiveHints >= limits.maxConsecutiveHints
  ) {
    // 4. Hint budget: never a third consecutive hint on one stuck thread.
    overrides.push("hint-cap-explain");
    move = "explain";
  } else if (move === "question" && state.stuckCounter >= 2) {
    // 5. The tutor SHALL NOT question endlessly: two stuck signals in a row
    //    escalate to concrete help instead of another question.
    overrides.push("stuck-question-hint");
    move = "hint";
  }

  let hintThread: TutorHintThread = { level: 0, consecutiveHints: 0 };
  let hintLevel = 0;
  if (move === "hint") {
    // 6. Monotonic per thread: at least previous + 1, at least 1, capped.
    const floor = Math.max(state.hintThread.level + 1, 1);
    const enforced = Math.min(limits.maxHintLevel, Math.max(modelTurn.hintLevel, floor));
    if (enforced !== modelTurn.hintLevel) overrides.push("hint-level-raised");
    hintLevel = enforced;
    hintThread = { level: enforced, consecutiveHints: state.hintThread.consecutiveHints + 1 };
  }
  // 7. (implicit) any non-hint move resets the thread — see `hintThread` init.

  // 8. Stuck counter: consecutive stuck signals; delivered help resolves it.
  const nextStuckCounter =
    move === "explain" || move === "wrap-up" ? 0 : stuckDetected ? state.stuckCounter + 1 : 0;

  const turn: TutorTurn = {
    move,
    content: modelTurn.content,
    hintLevel: move === "hint" ? hintLevel : 0,
    stuckDetected: move === "explain" || move === "wrap-up" ? false : stuckDetected,
    // promoteToCard only ever ships on a wrap-up turn.
    promoteToCard: move === "wrap-up" ? modelTurn.promoteToCard : undefined,
  };

  return {
    turn,
    overrides,
    state: {
      stuckCounter: nextStuckCounter,
      hintThread,
      forcedExplain: false,
      tutorTurnCount: state.tutorTurnCount + 1,
      ended: move === "wrap-up",
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Session (orchestrates the model + retrieval + policy)
// ──────────────────────────────────────────────────────────────────────────

/** One transcript entry (what the UI renders). */
export interface TutorTranscriptTurn {
  role: "user" | "tutor";
  text: string;
  /** Tutor turns only. */
  move?: TutorMove;
  hintLevel?: number;
  stuckDetected?: boolean;
  overrides?: TutorPolicyOverride[];
}

export interface TutorSessionConfig {
  topic: string;
  /** The selection/passage the session is grounded in. */
  material: string;
  documentTitle?: string;
  limits?: Partial<TutorPolicyLimits>;
  /** Retrieval width for prerequisite context (default k≈3). */
  retrievalK?: number;
  /** Max topic-drift retrieval refreshes (default 2). */
  maxRetrievalRefreshes?: number;
}

export type TutorRetrieve = (
  query: string,
  options: { k?: number }
) => Promise<RetrievalResponse>;

export type TutorRunTurn = (
  input: TutorTurnTaskInput,
  options?: AITaskRunOptions
) => Promise<AITaskResult<TutorTurn>>;

export interface TutorRuntime {
  /** Injectable retrieval (tests / eval fixtures). */
  retrieve?: TutorRetrieve;
  /** Injectable model call (pure state-machine tests). */
  runTurn?: TutorRunTurn;
  /** Explicit provider injection (FakeAIProvider eval runs). */
  provider?: AIProvider;
}

export interface TutorCallOptions {
  signal?: AbortSignal;
  /** Streamed raw response text (the UI distills a live preview). */
  onChunk?: (chunk: string) => void;
}

/** Provenance of the last model run (card promotion hand-off). */
export interface TutorRunMeta {
  providerId: string;
  servedModelClass: string;
  baseModelName?: string;
}

export class TutorSession {
  readonly config: TutorSessionConfig;
  readonly limits: TutorPolicyLimits;

  private readonly retrieveFn: TutorRetrieve;
  private readonly runTurnFn: TutorRunTurn;
  private readonly provider?: AIProvider;
  private readonly retrievalK: number;
  private readonly maxRetrievalRefreshes: number;

  private policy: TutorPolicyState = initialTutorPolicyState();
  private transcript: TutorTranscriptTurn[] = [];
  private retrieval: {
    query: string;
    signature: Set<string>;
    chunks: string[];
    chunkIds: string[];
  } = { query: "", signature: new Set(), chunks: [], chunkIds: [] };
  private retrievalRefreshes = 0;
  private wrapUpPromotion: TutorCardPromotion | null = null;
  private lastRun: TutorRunMeta | null = null;

  private constructor(config: TutorSessionConfig, runtime: TutorRuntime = {}) {
    this.config = config;
    this.limits = { ...DEFAULT_TUTOR_LIMITS, ...config.limits };
    this.retrievalK = config.retrievalK ?? TUTOR_RETRIEVAL_K;
    this.maxRetrievalRefreshes =
      config.maxRetrievalRefreshes ?? TUTOR_MAX_RETRIEVAL_REFRESHES;
    this.retrieveFn = runtime.retrieve ?? retrieveFromLibrary;
    this.runTurnFn = runtime.runTurn ?? runTutorTurn;
    this.provider = runtime.provider;
  }

  /**
   * Create a session and produce the opening turn (a guiding question —
   * the task instruction covers the empty-conversation case). Retrieval is
   * fetched first so the opening question is already grounded.
   */
  static async start(
    config: TutorSessionConfig,
    runtime: TutorRuntime = {},
    options: TutorCallOptions = {}
  ): Promise<TutorSession> {
    const session = new TutorSession(config, runtime);
    await session.refreshRetrieval(config.topic);
    await session.nextTurn(undefined, options);
    return session;
  }

  /** Submit the learner's answer and produce the next (bounded) tutor turn. */
  async submitUserAnswer(
    text: string,
    options: TutorCallOptions = {}
  ): Promise<TutorTranscriptTurn> {
    this.assertActive();
    const answer = text.trim();
    if (!answer) throw new Error("An empty answer cannot be submitted.");
    await this.refreshRetrievalOnDrift(answer);
    return this.nextTurn(answer, options);
  }

  /**
   * The "just explain it" escape hatch: the very next turn is a direct
   * explanation, no matter what the model would have preferred.
   */
  async requestExplain(
    userText?: string,
    options: TutorCallOptions = {}
  ): Promise<TutorTranscriptTurn> {
    this.assertActive();
    const recorded = userText?.trim() || "Please just explain it to me directly.";
    this.policy = { ...this.policy, forcedExplain: true };
    return this.nextTurn(recorded, options);
  }

  /** Snapshot of the transcript (user + tutor turns, oldest first). */
  getTranscript(): readonly TutorTranscriptTurn[] {
    return this.transcript;
  }

  getPolicyState(): TutorPolicyState {
    return { ...this.policy, hintThread: { ...this.policy.hintThread } };
  }

  get ended(): boolean {
    return this.policy.ended;
  }

  /** Provider/model-class of the last model run (card-promotion provenance). */
  get lastRunMeta(): TutorRunMeta | null {
    return this.lastRun;
  }

  /**
   * Card candidate for the standard Learn-this preview flow: the model's
   * `promoteToCard` from the wrap-up turn, or a deterministic fallback built
   * from the topic + the wrap-up summary.
   */
  getPromotion(): TutorCardPromotion | null {
    const wrapUp = [...this.transcript].reverse().find((t) => t.role === "tutor");
    if (!wrapUp || wrapUp.move !== "wrap-up") return null;
    return this.wrapUpPromotion ?? { question: this.config.topic, answer: wrapUp.text };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private assertActive(): void {
    if (this.policy.ended) throw new Error("The tutoring session has ended.");
  }

  private async refreshRetrieval(query: string): Promise<void> {
    try {
      const response = await this.retrieveFn(query, { k: this.retrievalK });
      this.retrieval = {
        query,
        signature: topicSignature(query),
        chunks: response.results.map((r) => capText(r.text, TUTOR_CHUNK_MAX_CHARS)),
        chunkIds: response.results.map((r) => r.chunkId),
      };
    } catch {
      // Grounding degrades to material-only; tutoring must not fail because
      // the index is unavailable.
      this.retrieval = { query, signature: topicSignature(query), chunks: [], chunkIds: [] };
    }
  }

  /**
   * Refresh the retrieved prerequisite context only when the conversation's
   * dominant term left the retrieval signature (topic drift), and only while
   * the per-session refresh budget lasts (≤ 2).
   */
  private async refreshRetrievalOnDrift(answer: string): Promise<void> {
    if (this.retrievalRefreshes >= this.maxRetrievalRefreshes) return;
    const driftedTerm = detectTopicDrift(this.retrieval.signature, answer);
    if (!driftedTerm) return;
    this.retrievalRefreshes += 1;
    await this.refreshRetrieval(`${this.config.topic} ${driftedTerm}`);
  }

  /**
   * Run one model turn and enforce the policy on its output. `pendingUser`
   * is the learner's just-submitted text; it enters the model input as the
   * last conversation entry but is only recorded in the transcript once the
   * turn succeeded (a failed call leaves the session unchanged for a clean
   * retry).
   */
  private async nextTurn(
    pendingUser: string | undefined,
    options: TutorCallOptions
  ): Promise<TutorTranscriptTurn> {
    const conversationSource: TutorConversationEntry[] = this.transcript.map((t) => ({
      role: t.role,
      text: t.text,
    }));
    if (pendingUser !== undefined) {
      conversationSource.push({ role: "user", text: pendingUser });
    }

    const context = buildTutorContext(conversationSource, this.config.topic);
    const forcedMove: TutorTurnTaskInput["forcedMove"] = this.policy.forcedExplain
      ? "explain"
      : this.policy.tutorTurnCount + 1 >= this.limits.maxSessionTurns
        ? "wrap-up"
        : undefined;

    const input: TutorTurnTaskInput = {
      topic: this.config.topic,
      selectedMaterial: capText(this.config.material, TUTOR_MATERIAL_MAX_CHARS),
      retrievedContext: this.retrieval.chunks,
      conversation: context.recentTurns,
      summary: context.summary,
      stuckCounter: this.policy.stuckCounter,
      hintThread: this.policy.hintThread,
      forcedMove,
    };

    const runOptions: AITaskRunOptions = {
      signal: options.signal,
      onChunk: options.onChunk,
      retrieval: { count: this.retrieval.chunkIds.length, chunkIds: this.retrieval.chunkIds },
    };
    if (this.provider) runOptions.provider = this.provider;

    const run = await this.runTurnFn(input, runOptions);
    this.lastRun = {
      providerId: run.providerId,
      servedModelClass: run.servedModelClass,
      baseModelName: run.baseModelName,
    };

    const enforced = enforceTutorPolicy(run.output, this.policy, this.limits);
    this.policy = enforced.state;
    if (enforced.turn.move === "wrap-up") {
      this.wrapUpPromotion = enforced.turn.promoteToCard ?? null;
    }

    if (pendingUser !== undefined) {
      this.transcript.push({ role: "user", text: pendingUser });
    }
    const entry: TutorTranscriptTurn = {
      role: "tutor",
      text: enforced.turn.content,
      move: enforced.turn.move,
      hintLevel: enforced.turn.hintLevel,
      stuckDetected: enforced.turn.stuckDetected,
      overrides: enforced.overrides,
    };
    this.transcript.push(entry);
    return entry;
  }
}
