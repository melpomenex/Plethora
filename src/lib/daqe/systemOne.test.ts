import { describe, expect, it, vi } from "vitest";
import {
  COMPLEXITY_LEVELS,
  DAQE_QUESTION_NAMES,
  SystemOneError,
  SYSTEM_ONE_LIMITS,
  TIER_CHOICE_OPTIONS,
  buildItemDecision,
  callSystemOne,
  decideForItem,
  readItemDecision,
  validateSystemOneRequest,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./systemOne";

/** A response in the shape the docs show, so the reader is tested against the wire. */
function responseFixture(overrides: Partial<SystemOneResponse> = {}): SystemOneResponse {
  return {
    model: "jev-latest",
    answers: {
      [DAQE_QUESTION_NAMES.tier]: {
        type: "choice",
        choice: "medium-analysis",
        probabilities: { "surface-skim": 0.08, "medium-analysis": 0.86, "deep-foundational": 0.06 },
        confidence: 0.86,
      },
      [DAQE_QUESTION_NAMES.complexity]: {
        type: "score",
        score: 1.4,
        confidence: 0.88,
      },
      [DAQE_QUESTION_NAMES.readyToReview]: { type: "noul", noul: 0.12 },
    },
    usage: { input_tokens: 136, output_tokens: 18 },
    ...overrides,
  };
}

/** A fetch that answers with `body` and records what it was asked. */
function stubFetch(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json", ...init.headers },
    });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("buildItemDecision", () => {
  it("asks all three questions in one request", () => {
    // The protocol bills `state` once per request, so three separate calls would
    // triple the cost for identical information.
    const request = buildItemDecision({ state: "outline" });
    expect(Object.keys(request.questions)).toHaveLength(3);
    expect(request.questions[DAQE_QUESTION_NAMES.tier].type).toBe("choice");
    expect(request.questions[DAQE_QUESTION_NAMES.complexity].type).toBe("score");
    expect(request.questions[DAQE_QUESTION_NAMES.readyToReview].type).toBe("noul");
  });

  it("offers exactly the three cognitive-load tiers as choice options", () => {
    const request = buildItemDecision({ state: "x" });
    const criteria = (request.questions[DAQE_QUESTION_NAMES.tier] as { criteria: object })
      .criteria;
    expect(Object.keys(criteria)).toEqual(Object.keys(TIER_CHOICE_OPTIONS));
  });

  it("scores on the same 1-5 scale energy fit measures against", () => {
    const request = buildItemDecision({ state: "x" });
    const criteria = (request.questions[DAQE_QUESTION_NAMES.complexity] as { criteria: string[] })
      .criteria;
    // Five levels means four intervals, so the score spans 0..4 and normalizes to 0..1.
    expect(criteria).toEqual([...COMPLEXITY_LEVELS]);
    expect(criteria.length).toBe(5);
  });

  it("weaves the goal into the instructions, not into the state", () => {
    // The state is what gets cached by content hash; a goal belongs to the
    // session and must not make an otherwise-cached judgement session-specific.
    const request = buildItemDecision({ state: "the same outline", goal: "learn transformers" });
    expect(JSON.stringify(request.state)).not.toContain("transformers");
    expect(
      JSON.stringify(request.questions[DAQE_QUESTION_NAMES.tier]),
    ).toContain("learn transformers");
  });

  it("asks a different gate question for new items than for studied ones", () => {
    const newItem = buildItemDecision({ state: "x", isNew: true });
    const studied = buildItemDecision({ state: "x", isNew: false });
    expect(
      JSON.stringify(newItem.questions[DAQE_QUESTION_NAMES.readyToReview]),
    ).not.toEqual(JSON.stringify(studied.questions[DAQE_QUESTION_NAMES.readyToReview]));
  });

  it("produces a request that passes validation", () => {
    expect(validateSystemOneRequest(buildItemDecision({ state: "x", goal: "g" }))).toEqual([]);
  });
});

describe("validateSystemOneRequest", () => {
  const base = buildItemDecision({ state: "outline" });

  it("rejects more than eight questions, naming the limit", () => {
    const questions: SystemOneRequest["questions"] = {};
    for (let i = 0; i < SYSTEM_ONE_LIMITS.maxQuestions + 1; i += 1) {
      questions[`q${i}`] = { type: "noul", instructions: "is it?" };
    }
    const problems = validateSystemOneRequest({ ...base, questions });
    expect(problems.some((p) => p.path === "questions" && p.reason.includes("8"))).toBe(true);
  });

  it("rejects an empty question map", () => {
    expect(validateSystemOneRequest({ ...base, questions: {} }).length).toBeGreaterThan(0);
  });

  it("rejects an oversized state", () => {
    const problems = validateSystemOneRequest({
      ...base,
      state: "x".repeat(SYSTEM_ONE_LIMITS.maxStateChars + 1),
    });
    expect(problems.some((p) => p.path === "state")).toBe(true);
  });

  it("measures a non-string state by its serialized length", () => {
    const big = { outline: "x".repeat(SYSTEM_ONE_LIMITS.maxStateChars) };
    expect(validateSystemOneRequest({ ...base, state: big }).some((p) => p.path === "state")).toBe(
      true,
    );
  });

  it("rejects an oversized instruction", () => {
    const problems = validateSystemOneRequest({
      ...base,
      questions: {
        x: { type: "noul", instructions: "y".repeat(SYSTEM_ONE_LIMITS.maxInstructionsChars + 1) },
      },
    });
    expect(problems.some((p) => p.path.includes("instructions"))).toBe(true);
  });

  it("rejects a choice with too few options", () => {
    const problems = validateSystemOneRequest({
      ...base,
      questions: { x: { type: "choice", instructions: "pick", criteria: { only: "one" } } },
    });
    expect(problems.some((p) => p.reason.includes("2-20"))).toBe(true);
  });

  it("rejects a score with too few levels", () => {
    const problems = validateSystemOneRequest({
      ...base,
      questions: { x: { type: "score", instructions: "where", criteria: ["only"] } },
    });
    expect(problems.some((p) => p.reason.includes("2-10"))).toBe(true);
  });

  it("rejects a question name that is not an identifier", () => {
    const problems = validateSystemOneRequest({
      ...base,
      questions: { "has spaces": { type: "noul", instructions: "x" } },
    });
    expect(problems.some((p) => p.reason.includes("identifier"))).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    const problems = validateSystemOneRequest({
      state: "x".repeat(SYSTEM_ONE_LIMITS.maxStateChars + 1),
      questions: {
        "bad name": { type: "choice", instructions: "pick", criteria: { a: "1" } },
      },
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("readItemDecision", () => {
  it("reads all three primitives from a well-formed response", () => {
    const decision = readItemDecision(responseFixture());
    expect(decision.tier).toBe("medium-analysis");
    expect(decision.readyToReview).toBe(false);
    expect(decision.inputTokens).toBe(136);
    expect(decision.score).toBeCloseTo(0.86);
  });

  it("normalizes the score onto 0..1 across the levels scale", () => {
    const bottom = readItemDecision(
      responseFixture({
        answers: { [DAQE_QUESTION_NAMES.complexity]: { type: "score", score: 0 } },
      }),
    );
    const top = readItemDecision(
      responseFixture({
        answers: { [DAQE_QUESTION_NAMES.complexity]: { type: "score", score: 4 } },
      }),
    );
    expect(bottom.complexity).toBe(0);
    expect(top.complexity).toBe(1);
  });

  it("clamps a score beyond the scale rather than passing it through", () => {
    const over = readItemDecision(
      responseFixture({
        answers: { [DAQE_QUESTION_NAMES.complexity]: { type: "score", score: 99 } },
      }),
    );
    expect(over.complexity).toBe(1);
  });

  it("reports an absent question as null rather than zero", () => {
    // A zero would be a fabricated measurement the ranker would then present.
    const decision = readItemDecision({ answers: {} });
    expect(decision.tier).toBeNull();
    expect(decision.score).toBeNull();
    expect(decision.complexity).toBeNull();
    expect(decision.readyToReview).toBeNull();
  });

  it("keeps the fields it does have when one answer is malformed", () => {
    // Losing the gate must not also lose the tier.
    const decision = readItemDecision(
      responseFixture({
        answers: {
          [DAQE_QUESTION_NAMES.tier]: {
            type: "choice",
            choice: "deep-foundational",
            probabilities: { "deep-foundational": 0.99 },
          },
          [DAQE_QUESTION_NAMES.readyToReview]: { type: "noul", noul: "not a number" } as never,
        },
      }),
    );
    expect(decision.tier).toBe("deep-foundational");
    expect(decision.readyToReview).toBeNull();
  });

  it("rejects a choice outside the three known tiers", () => {
    const decision = readItemDecision(
      responseFixture({
        answers: {
          [DAQE_QUESTION_NAMES.tier]: { type: "choice", choice: "something-new" },
        },
      }),
    );
    expect(decision.tier).toBeNull();
  });

  it("falls back to confidence when a choice carries no distribution", () => {
    const decision = readItemDecision(
      responseFixture({
        answers: {
          [DAQE_QUESTION_NAMES.tier]: {
            type: "choice",
            choice: "surface-skim",
            confidence: 0.7,
          },
        },
      }),
    );
    expect(decision.score).toBe(0.7);
  });

  it("falls back to a neutral 0.5 with neither distribution nor confidence", () => {
    const decision = readItemDecision(
      responseFixture({
        answers: { [DAQE_QUESTION_NAMES.tier]: { type: "choice", choice: "surface-skim" } },
      }),
    );
    expect(decision.score).toBe(0.5);
  });

  it("reads the gate at a 0.5 threshold", () => {
    const yes = readItemDecision(
      responseFixture({
        answers: { [DAQE_QUESTION_NAMES.readyToReview]: { type: "noul", noul: 0.5 } },
      }),
    );
    expect(yes.readyToReview).toBe(true);
  });

  it("survives a response with no answers object", () => {
    expect(readItemDecision({ answers: undefined } as unknown as SystemOneResponse).tier).toBeNull();
  });
});

describe("callSystemOne", () => {
  it("posts to /v1/systemone with bearer auth and the model", async () => {
    const { impl, calls } = stubFetch(responseFixture());
    await callSystemOne(
      { baseUrl: "https://example.test", apiKey: "sk-1", model: "jev-latest", fetchImpl: impl },
      buildItemDecision({ state: "x" }),
    );
    const [call] = calls;
    expect(call.url).toBe("https://example.test/v1/systemone");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-1");
    const body = JSON.parse(String(call.init.body));
    expect(body.model).toBe("jev-latest");
    expect(body.state).toBe("x");
  });

  it("omits the model field when the endpoint serves only one", async () => {
    const { impl, calls } = stubFetch(responseFixture());
    await callSystemOne({ baseUrl: "https://example.test", fetchImpl: impl }, buildItemDecision({ state: "x" }));
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBeUndefined();
  });

  it("omits auth when no key is configured, for a local server", async () => {
    const { impl, calls } = stubFetch(responseFixture());
    await callSystemOne({ baseUrl: "http://127.0.0.1:8000", fetchImpl: impl }, buildItemDecision({ state: "x" }));
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("forwards an idempotency key so a retry cannot be charged twice", async () => {
    const { impl, calls } = stubFetch(responseFixture());
    await callSystemOne(
      { baseUrl: "https://example.test", fetchImpl: impl },
      buildItemDecision({ state: "x" }),
      { idempotencyKey: "item-abc-rubric-1" },
    );
    expect((calls[0].init.headers as Record<string, string>)["idempotency-key"]).toBe(
      "item-abc-rubric-1",
    );
  });

  it("rejects an invalid request before making a call", async () => {
    // The endpoint returns 422 for these without billing; refusing locally saves
    // the round trip and guarantees the request is well-formed.
    const { impl, calls } = stubFetch(responseFixture());
    await expect(
      callSystemOne(
        { baseUrl: "https://example.test", fetchImpl: impl },
        { state: "x".repeat(SYSTEM_ONE_LIMITS.maxStateChars + 1), questions: {} },
      ),
    ).rejects.toMatchObject({ reason: "invalid-request" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "unauthorized", false],
    [402, "insufficient-credits", false],
    [422, "invalid-request", false],
    [429, "rate-limited", true],
    [502, "upstream-error", true],
    [503, "upstream-error", true],
    [418, "http-error", false],
  ])("maps HTTP %i to %s", async (status, reason, retryable) => {
    const { impl } = stubFetch({ error: { type: "x", message: "boom" } }, { status });
    const error = await callSystemOne(
      { baseUrl: "https://example.test", fetchImpl: impl },
      buildItemDecision({ state: "x" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SystemOneError);
    expect((error as SystemOneError).reason).toBe(reason);
    expect((error as SystemOneError).retryable).toBe(retryable);
  });

  it("surfaces the endpoint's own error message", async () => {
    const { impl } = stubFetch(
      { error: { type: "invalid_request_error", message: "At most 8 questions per request." } },
      { status: 422 },
    );
    await expect(
      callSystemOne({ baseUrl: "https://example.test", fetchImpl: impl }, buildItemDecision({ state: "x" })),
    ).rejects.toThrow(/At most 8 questions/);
  });

  it("rejects a response with no answers object", async () => {
    const { impl } = stubFetch({ model: "x" } as unknown as SystemOneResponse);
    await expect(
      callSystemOne({ baseUrl: "https://example.test", fetchImpl: impl }, buildItemDecision({ state: "x" })),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  });

  it("reports a refused connection as unreachable", async () => {
    const impl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      callSystemOne({ baseUrl: "https://example.test", fetchImpl: impl }, buildItemDecision({ state: "x" })),
    ).rejects.toMatchObject({ reason: "unreachable" });
  });

  it("reports an aborted call as a timeout, distinctly from unreachable", async () => {
    // The two mean different things when reading diagnostics: "this provider is
    // slow" versus "this provider is absent".
    const impl = vi.fn(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;
    await expect(
      callSystemOne(
        { baseUrl: "https://example.test", timeoutMs: 5, fetchImpl: impl },
        buildItemDecision({ state: "x" }),
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("never returns a partial shape on failure", async () => {
    // The ranker decides "unavailable" by catching; a partially-populated answer
    // would make a failed call indistinguishable from a weak one.
    const { impl } = stubFetch({ error: { message: "no" } }, { status: 502 });
    const result = await callSystemOne(
      { baseUrl: "https://example.test", fetchImpl: impl },
      buildItemDecision({ state: "x" }),
    ).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(SystemOneError);
    expect((result as unknown as { answers?: unknown }).answers).toBeUndefined();
  });

  it("unwraps responses wrapped in a result envelope (Workers AI)", async () => {
    const { impl } = stubFetch({
      result: {
        model: "@cf/cloudflare/clef",
        answers: {
          [DAQE_QUESTION_NAMES.tier]: { type: "choice", choice: "surface-skim" },
          [DAQE_QUESTION_NAMES.complexity]: { type: "score", score: 2 },
          [DAQE_QUESTION_NAMES.readyToReview]: { type: "noul", noul: 1.0 },
        },
        usage: { input_tokens: 30 },
      },
      success: true,
    } as unknown as SystemOneResponse);
    const result = await callSystemOne(
      { baseUrl: "https://example.test", fetchImpl: impl },
      buildItemDecision({ state: "x" }),
    );
    expect(result.answers).toBeDefined();
    expect(result.answers[DAQE_QUESTION_NAMES.tier]).toEqual({
      type: "choice",
      choice: "surface-skim",
    });
  });
});

describe("decideForItem", () => {
  it("builds, calls, and reads in one step", async () => {
    const { impl } = stubFetch(responseFixture());
    const decision = await decideForItem(
      { baseUrl: "https://example.test", apiKey: "sk", fetchImpl: impl },
      { state: { outline: ["1 Intro"] }, goal: "learn transformers" },
    );
    expect(decision.tier).toBe("medium-analysis");
    expect(decision.complexity).toBeCloseTo(0.35);
  });

  it("works against a local server with no key", async () => {
    const { impl, calls } = stubFetch(responseFixture());
    await decideForItem(
      { baseUrl: "http://127.0.0.1:8000", fetchImpl: impl },
      { state: "x" },
    );
    expect(calls[0].url).toBe("http://127.0.0.1:8000/v1/systemone");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });
});