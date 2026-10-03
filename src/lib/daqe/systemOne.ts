/**
 * System One — the typed decision protocol shared by Jev, Laya, Clef, and the
 * decision models on OpenRouter.
 *
 * ## Why one client covers four products
 *
 * These are not four integrations. They are four deployments of one protocol:
 *
 * | Product | Base URL | Auth |
 * | --- | --- | --- |
 * | Jev (TypeSafe, hosted) | `https://jevmodel.org` | `Authorization: Bearer sk-…` |
 * | Laya (Convai, Apache 2.0) | your `laya-serve`, default `:8000` | bearer, optional |
 * | Clef (Cloudflare, Apache 2.0) | Workers AI, provider-specific | provider-specific |
 * | OpenRouter `decisions` | `https://openrouter.ai/api/v1` | `Authorization: Bearer …` |
 *
 * All of them accept `POST /v1/systemone` with `{state, questions}` and answer
 * with `{answers}` keyed by question name. So the integration cost is one request
 * builder, one response reader, and a `baseUrl` — not four adapters.
 *
 * ## Why one request per item
 *
 * The protocol allows up to 8 questions per request and the state is billed once
 * and shared across them. DAQE needs exactly three answers about the same item,
 * so asking separately would triple the input cost for identical information.
 * `buildItemDecision` therefore emits all three questions in one call.
 *
 * ## The three primitives map 1:1 onto the ranker's trait
 *
 * - `evaluateChoice` → a `choice` question whose options are the three
 *   cognitive-load tiers. The protocol wants 2–20 options; we have exactly 3.
 * - `evaluateScore` → a `score` question whose levels are the 1–5 complexity
 *   scale, normalized back to `[0,1]`.
 * - `evaluateNoul` → a `noul` question, i.e. P(yes).
 *
 * ## Validation is not optional here
 *
 * The endpoint rejects malformed bodies with 422 *before* reserving tokens, so
 * bad input is never billed. The limits below are enforced client-side for that
 * reason and because a silently-truncated question would yield a confident,
 * wrong answer.
 */

/** The protocol's documented per-request limits. */
export const SYSTEM_ONE_LIMITS = {
  /** Questions per request. Validation failures return 422 and are not billed. */
  maxQuestions: 8,
  /** Serialized `state`, in characters. */
  maxStateChars: 8_000,
  /** `instructions` per question, in characters. */
  maxInstructionsChars: 1_800,
  /** Serialized `criteria` per question, in characters. */
  maxCriteriaChars: 2_000,
  /** A question name must be an identifier. */
  maxNameChars: 64,
  /** `choice` options, inclusive. */
  minChoiceOptions: 2,
  maxChoiceOptions: 20,
  /** `score` levels, inclusive. */
  minScoreLevels: 2,
  maxScoreLevels: 10,
} as const;

export type SystemOneQuestionType = "choice" | "score" | "noul";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** 2–20 option keys mapped to what each one means. */
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** 2–10 levels, ordered low to high. */
  criteria: string[];
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  /** Optional descriptions of the two outcomes. */
  criteria?: { true?: string; false?: string };
}

export type SystemOneQuestion =
  | ChoiceQuestion
  | ScoreQuestion
  | NoulQuestion;

export interface SystemOneRequest {
  /** Omitted by providers that serve a single model (Workers AI, Laya). */
  model?: string;
  /** The text or JSON under judgement. */
  state: unknown;
  questions: Record<string, SystemOneQuestion>;
}

export interface SystemOneChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface SystemOneScoreAnswer {
  type: "score";
  /** Position on the levels scale; fractional. */
  score: number;
  confidence?: number;
}

export interface SystemOneNoulAnswer {
  type: "noul";
  /** P(yes). */
  noul: number;
}

export type SystemOneAnswer =
  | SystemOneChoiceAnswer
  | SystemOneScoreAnswer
  | SystemOneNoulAnswer;

export interface SystemOneUsage {
  input_tokens?: number;
  output_tokens?: number;
}

export interface SystemOneResponse {
  model?: string;
  answers: Record<string, SystemOneAnswer>;
  usage?: SystemOneUsage;
}

/** The protocol's error envelope. */
export interface SystemOneErrorBody {
  error?: { type?: string; message?: string };
}

/** Which HTTP statuses are worth retrying. Everything else is the caller's fault. */
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export type SystemOneFailureReason =
  | "unreachable"
  | "timeout"
  | "unauthorized"
  | "insufficient-credits"
  | "rate-limited"
  | "invalid-request"
  | "invalid-response"
  | "unsupported-question"
  /** A retryable server-side failure: 502/503/504. */
  | "upstream-error"
  | "http-error";

export class SystemOneError extends Error {
  constructor(
    readonly reason: SystemOneFailureReason,
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "SystemOneError";
  }
}

export interface SystemOneClientOptions {
  baseUrl: string;
  /** Bearer token. Omitted for endpoints that need none (a local `laya-serve`). */
  apiKey?: string;
  /** Sent as the `model` field when the endpoint serves several. */
  model?: string;
  /** Per-call budget. Kept well inside the ranker's 150 ms top-ten budget. */
  timeoutMs?: number;
  /** Injected for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

/** Where the cognitive-load tiers sit in a `choice` question, in protocol order. */
export const TIER_CHOICE_OPTIONS = {
  "surface-skim": "A light skim: headlines, abstracts, or a short bulleted list.",
  "medium-analysis": "A considered read of a single section.",
  "deep-foundational": "Sustained close reading of a primary source.",
} as const;

export type TierChoiceKey = keyof typeof TIER_CHOICE_OPTIONS;

/**
 * The five complexity levels, low to high.
 *
 * These are the same 1–5 points `DecisionModelTier::complexity` uses and the
 * same scale `energy_fit` measures distance on, so the normalized score needs no
 * remapping beyond dividing by `levels - 1`.
 */
export const COMPLEXITY_LEVELS = [
  "trivial skim",
  "light",
  "moderate",
  "demanding",
  "dense primary source",
] as const;

/** The three questions DAQE asks about one item, in a single request. */
export const DAQE_QUESTION_NAMES = {
  tier: "load_tier",
  complexity: "complexity",
  readyToReview: "ready_to_review",
} as const;

export function buildItemDecision(input: {
  /** Structural outline — headings, type, length. Never body text. */
  state: unknown;
  /** The user's stated goal, woven into the instructions rather than the state. */
  goal?: string;
  /** Whether the item is new or already studied, which changes the gate. */
  isNew?: boolean;
}): SystemOneRequest {
  const goalClause = input.goal?.trim()
    ? ` The learner's stated goal for this session is: "${input.goal.trim()}".`
    : "";

  const questions: Record<string, SystemOneQuestion> = {
    [DAQE_QUESTION_NAMES.tier]: {
      type: "choice",
      instructions:
        "How much reading does this item demand?" + goalClause,
      criteria: { ...TIER_CHOICE_OPTIONS },
    },
    [DAQE_QUESTION_NAMES.complexity]: {
      type: "score",
      instructions:
        "Where does this item sit between a trivial skim and a dense primary source?" +
        goalClause,
      criteria: [...COMPLEXITY_LEVELS],
    },
    [DAQE_QUESTION_NAMES.readyToReview]: {
      type: "noul",
      instructions: input.isNew
        ? "Is this item self-contained enough to study on its own, with no prior reading required?"
        : "Do this item's apparent prerequisites look satisfied by the structure alone?",
      criteria: {
        true: "Self-contained, or its prerequisites appear met.",
        false: "Appears to depend on material the learner has not covered.",
      },
    },
  };

  return { state: input.state, questions };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** A request that violates the documented limits, named. */
export interface RequestProblem {
  path: string;
  reason: string;
}

const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

function serializedLength(value: unknown): number {
  return typeof value === "string" ? value.length : JSON.stringify(value)?.length ?? 0;
}

/**
 * Check a request against the protocol's documented limits.
 *
 * Returns every problem rather than the first, because a caller fixing a
 * malformed request should see all of them at once. The endpoint would return
 * only the first as a 422.
 */
export function validateSystemOneRequest(request: SystemOneRequest): RequestProblem[] {
  const problems: RequestProblem[] = [];
  const names = Object.keys(request.questions ?? {});

  if (names.length === 0) {
    problems.push({ path: "questions", reason: "at least one question is required" });
  }
  if (names.length > SYSTEM_ONE_LIMITS.maxQuestions) {
    problems.push({
      path: "questions",
      reason: `at most ${SYSTEM_ONE_LIMITS.maxQuestions} questions per request, got ${names.length}`,
    });
  }

  const stateChars = serializedLength(request.state);
  if (stateChars > SYSTEM_ONE_LIMITS.maxStateChars) {
    problems.push({
      path: "state",
      reason: `serialized state is ${stateChars} characters, limit ${SYSTEM_ONE_LIMITS.maxStateChars}`,
    });
  }

  for (const name of names) {
    if (name.length > SYSTEM_ONE_LIMITS.maxNameChars || !NAME_PATTERN.test(name)) {
      problems.push({
        path: `questions.${name}`,
        reason: "question names must be identifiers of at most 64 characters",
      });
    }

    const question = request.questions[name];
    if (!question) continue;

    if ((question.instructions?.length ?? 0) > SYSTEM_ONE_LIMITS.maxInstructionsChars) {
      problems.push({
        path: `questions.${name}.instructions`,
        reason: `over ${SYSTEM_ONE_LIMITS.maxInstructionsChars} characters`,
      });
    }

    if (question.type === "choice") {
      const keys = Object.keys(question.criteria ?? {});
      if (
        keys.length < SYSTEM_ONE_LIMITS.minChoiceOptions ||
        keys.length > SYSTEM_ONE_LIMITS.maxChoiceOptions
      ) {
        problems.push({
          path: `questions.${name}.criteria`,
          reason: `choice needs ${SYSTEM_ONE_LIMITS.minChoiceOptions}-${SYSTEM_ONE_LIMITS.maxChoiceOptions} options, got ${keys.length}`,
        });
      }
    }

    if (question.type === "score") {
      const levels = question.criteria?.length ?? 0;
      if (levels < SYSTEM_ONE_LIMITS.minScoreLevels || levels > SYSTEM_ONE_LIMITS.maxScoreLevels) {
        problems.push({
          path: `questions.${name}.criteria`,
          reason: `score needs ${SYSTEM_ONE_LIMITS.minScoreLevels}-${SYSTEM_ONE_LIMITS.maxScoreLevels} levels, got ${levels}`,
        });
      }
    }

    const criteriaChars =
      question.type === "noul" && question.criteria
        ? serializedLength(question.criteria)
        : question.type === "choice"
          ? serializedLength(question.criteria)
          : serializedLength(question.criteria);
    if (criteriaChars > SYSTEM_ONE_LIMITS.maxCriteriaChars) {
      problems.push({
        path: `questions.${name}.criteria`,
        reason: `serialized criteria is ${criteriaChars} characters, limit ${SYSTEM_ONE_LIMITS.maxCriteriaChars}`,
      });
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* Reading a response into the ranker's primitives                     */
/* ------------------------------------------------------------------ */

/** Mirrors `DecisionModelTier` in `src-tauri/src/models/daqe.rs`. */
export type DecisionTier = "surface-skim" | "medium-analysis" | "deep-foundational";

const TIER_COMPLEXITY: Record<DecisionTier, number> = {
  "surface-skim": 1,
  "medium-analysis": 3,
  "deep-foundational": 5,
};

/** What the ranker consumes: the three primitives, already normalized. */
export interface ItemDecision {
  /** 0–1, or `null` when the answer was absent or unusable. */
  score: number | null;
  tier: DecisionTier | null;
  /** On the shared 1–5 complexity scale, or `null`. */
  complexity: number | null;
  /** `evaluateNoul`'s gate, or `null`. */
  readyToReview: boolean | null;
  /** Billed input tokens, for diagnostics. */
  inputTokens?: number;
}

function isChoiceAnswer(value: unknown): value is SystemOneChoiceAnswer {
  return !!value && typeof (value as SystemOneChoiceAnswer).choice === "string";
}

function isScoreAnswer(value: unknown): value is SystemOneScoreAnswer {
  return !!value && typeof (value as SystemOneScoreAnswer).score === "number";
}

function isNoulAnswer(value: unknown): value is SystemOneNoulAnswer {
  return !!value && typeof (value as SystemOneNoulAnswer).noul === "number";
}

/**
 * A `choice` answer's `probabilities` are the score.
 *
 * The probability of the *selected* option is a better `[0,1]` fit than the
 * tier itself, and it is already calibrated. Used when present.
 */
function scoreFromChoice(answer: SystemOneChoiceAnswer): number | null {
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== "object") {
    // No distribution: fall back to confidence, then to a neutral 0.5.
    return typeof answer.confidence === "number" ? answer.confidence : 0.5;
  }
  const chosen = probabilities[answer.choice];
  return typeof chosen === "number" && Number.isFinite(chosen) ? chosen : null;
}

/**
 * A `score` answer is a position on the levels scale; normalize to `[0,1]`.
 *
 * The protocol documents `score` as possibly fractional on a scale whose length
 * is the number of levels. Dividing by `levels - 1` maps the endpoints onto 0 and
 * 1, which is what `energy_fit` expects.
 */
function complexityFromScore(
  answer: SystemOneScoreAnswer,
  levelCount: number,
): number | null {
  if (!Number.isFinite(answer.score)) return null;
  const maxIndex = Math.max(1, levelCount - 1);
  const normalized = answer.score / maxIndex;
  if (!Number.isFinite(normalized)) return null;
  return Math.min(1, Math.max(0, normalized));
}

/**
 * Read a response into the ranker's three primitives.
 *
 * Every field is independently nullable. A partial answer is usable — losing the
 * gate must not also lose the tier, which is what a whole-response `null` would
 * cause. The ranker treats a `null` as "untracked" and falls back for that term
 * alone, which is the difference between an honest estimate and a fabricated one.
 */
export function readItemDecision(
  response: SystemOneResponse,
  levelCount = COMPLEXITY_LEVELS.length,
): ItemDecision {
  const answers = response?.answers ?? {};

  const tierAnswer = answers[DAQE_QUESTION_NAMES.tier];
  let tier: DecisionTier | null = null;
  if (isChoiceAnswer(tierAnswer)) {
    const key = tierAnswer.choice;
    tier = key in TIER_COMPLEXITY ? (key as DecisionTier) : null;
  }

  const scoreAnswer = answers[DAQE_QUESTION_NAMES.complexity];
  const complexity = isScoreAnswer(scoreAnswer)
    ? complexityFromScore(scoreAnswer, levelCount)
    : null;

  const noulAnswer = answers[DAQE_QUESTION_NAMES.readyToReview];
  const readyToReview = isNoulAnswer(noulAnswer) ? noulAnswer.noul >= 0.5 : null;

  return {
    // Prefer the tier's own distribution: it is calibrated and already `[0,1]`.
    score: isChoiceAnswer(tierAnswer) ? scoreFromChoice(tierAnswer) : null,
    tier,
    complexity,
    readyToReview,
    inputTokens: response?.usage?.input_tokens,
  };
}

/* ------------------------------------------------------------------ */
/* Calling                                                             */
/* ------------------------------------------------------------------ */

export interface SystemOneCallOptions {
  /** Extra headers, merged last so a caller cannot drop the auth header by accident. */
  headers?: Record<string, string>;
  /**
   * Stable key so a retry settles against the same billing record rather than
   * charging twice. Callers should pass something derived from the content.
   */
  idempotencyKey?: string;
}

/**
 * Call a System One endpoint.
 *
 * Rejects with {@link SystemOneError} on every failure rather than returning a
 * partial shape: the ranker's contract is that a failed call leaves its term
 * unavailable, and it decides that by catching. Throwing here keeps "no answer"
 * and "bad answer" impossible to confuse.
 */
export async function callSystemOne(
  client: SystemOneClientOptions,
  request: SystemOneRequest,
  options: SystemOneCallOptions = {},
): Promise<SystemOneResponse> {
  const problems = validateSystemOneRequest(request);
  if (problems.length > 0) {
    throw new SystemOneError(
      "invalid-request",
      `request violates the protocol limits: ${problems
        .map((p) => `${p.path}: ${p.reason}`)
        .join("; ")}`,
    );
  }

  const doFetch = client.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new SystemOneError("unreachable", "no fetch implementation is available");
  }

  const url = `${client.baseUrl.replace(/\/$/, "")}/v1/systemone`;
  const controller =
    typeof AbortController === "function" ? new AbortController() : undefined;
  const timeoutMs = client.timeoutMs ?? 8_000;
  const timer =
    controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await doFetch(url, {
      method: "POST",
      signal: controller?.signal,
      headers: {
        "content-type": "application/json",
        ...(client.apiKey ? { authorization: `Bearer ${client.apiKey}` } : {}),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
        ...options.headers,
      },
      body: JSON.stringify({
        ...(client.model ? { model: client.model } : {}),
        state: request.state,
        questions: request.questions,
      }),
    });

    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw errorForStatus(response.status, detail);
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const payload = (
      raw?.result && typeof raw.result === "object" ? raw.result : raw
    ) as SystemOneResponse;
    if (!payload || typeof payload !== "object" || typeof payload.answers !== "object") {
      throw new SystemOneError(
        "invalid-response",
        "the endpoint answered without an `answers` object",
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof SystemOneError) throw error;
    // A thrown abort means the timeout fired, which is a distinct failure from a
    // refused connection: the first is "this provider is slow", the second is
    // "this provider is absent". The ranker treats both as unavailable, but the
    // distinction is what makes the diagnostics readable.
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))
    ) {
      throw new SystemOneError("timeout", `no answer within ${timeoutMs} ms`);
    }
    throw new SystemOneError(
      "unreachable",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as SystemOneErrorBody;
    return body?.error?.message ?? body?.error?.type ?? response.statusText;
  } catch {
    return response.statusText || `HTTP ${response.status}`;
  }
}

function errorForStatus(status: number, detail: string): SystemOneError {
  const retryable = RETRYABLE_STATUS.has(status);
  switch (status) {
    case 401:
    case 403:
      return new SystemOneError("unauthorized", detail, status, false);
    case 402:
      return new SystemOneError("insufficient-credits", detail, status, false);
    case 422:
      return new SystemOneError("invalid-request", detail, status, false);
    case 429:
      return new SystemOneError("rate-limited", detail, status, true);
    default:
      return new SystemOneError(
        retryable ? "upstream-error" : "http-error",
        detail,
        status,
        retryable,
      );
  }
}

/** Convenience: build the three questions, call, and read in one step. */
export async function decideForItem(
  client: SystemOneClientOptions,
  input: Parameters<typeof buildItemDecision>[0],
  options: SystemOneCallOptions = {},
): Promise<ItemDecision> {
  const response = await callSystemOne(client, buildItemDecision(input), options);
  return readItemDecision(response);
}