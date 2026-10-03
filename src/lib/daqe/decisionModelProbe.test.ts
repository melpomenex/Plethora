import { describe, expect, it } from "vitest";
import {
  PROBE_QUESTIONS,
  decisionModelLiveState,
  probeDecisionModel,
  probeSucceeded,
  readBackendProbe,
  type ProbeResult,
} from "./decisionModelProbe";

/**
 * The probe answers the only question a reader actually has after typing a key:
 * "is this working?"
 *
 * These tests pin the behaviours that make the answer trustworthy — that a probe
 * failure is returned rather than thrown, that a well-formed-but-wrong answer is
 * a warning rather than a failure, and that a green tick expires.
 */

const OK: ProbeResult = { outcome: "ok", latencyMs: 120, resolvedModel: "jev-latest" };

function stubFetch(body: unknown, status = 200) {
  const impl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  return impl;
}

function answeringFetch(choice: string, noul = 0.95) {
  return stubFetch({
    model: "test-model",
    answers: {
      [PROBE_QUESTIONS.action]: { type: "choice", choice },
      [PROBE_QUESTIONS.definite]: { type: "noul", noul },
    },
    usage: { input_tokens: 42 },
  });
}

describe("probeDecisionModel", () => {
  it("succeeds on the expected answer and reports what it cost", async () => {
    const result = await probeDecisionModel({
      baseUrl: "https://example.test",
      apiKey: "sk-1",
      fetchImpl: answeringFetch("submitted"),
    });

    expect(result.outcome).toBe("ok");
    expect(probeSucceeded(result)).toBe(true);
    expect(result.resolvedModel).toBe("test-model");
    expect(result.inputTokens).toBe(42);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("sends exactly two questions, so the probe stays cheap", async () => {
    const calls: string[] = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      calls.push(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: {
            [PROBE_QUESTIONS.action]: { type: "choice", choice: "submitted" },
            [PROBE_QUESTIONS.definite]: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await probeDecisionModel({ baseUrl: "https://example.test", fetchImpl: impl });
    const body = JSON.parse(calls[0]);
    expect(Object.keys(body.questions)).toHaveLength(2);
    expect(JSON.stringify(body.state).length).toBeLessThan(200);
  });

  it("reuses a stable idempotency key so a second press is not billed twice", async () => {
    const headers: string[] = [];
    const impl = (async (_url: string, init?: RequestInit) => {
      headers.push(String((init?.headers as Record<string, string>)["idempotency-key"]));
      return new Response(
        JSON.stringify({
          answers: {
            [PROBE_QUESTIONS.action]: { type: "choice", choice: "submitted" },
            [PROBE_QUESTIONS.definite]: { type: "noul", noul: 0.9 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = { baseUrl: "https://example.test", model: "m", fetchImpl: impl };
    await probeDecisionModel(client);
    await probeDecisionModel(client);
    expect(headers[0]).toBe(headers[1]);
    expect(headers[0]).toContain("daqe-probe");
  });

  it("warns rather than fails when the endpoint answers the wrong thing", async () => {
    // A well-formed answer to a nonsense question means the transport, the key and
    // the schema all work. Calling that a failure would teach readers to ignore
    // the result — and it is the signature of a wrong model id.
    const result = await probeDecisionModel({
      baseUrl: "https://example.test",
      fetchImpl: answeringFetch("cancelled"),
    });
    expect(result.outcome).toBe("answered-unexpectedly");
    expect(probeSucceeded(result)).toBe(false);
    expect(result.detail).toContain("cancelled");
  });

  it("reports a 200 that answers nothing as not-a-decisions-endpoint", async () => {
    const result = await probeDecisionModel({
      baseUrl: "https://example.test",
      fetchImpl: stubFetch({ answers: {} }),
    });
    expect(result.outcome).toBe("no-answer");
  });

  it("returns a failure rather than throwing, so no call site needs a try/catch", async () => {
    for (const [status, reason] of [
      [401, "unauthorized"],
      [402, "insufficient-credits"],
      [403, "unauthorized"],
      [429, "rate-limited"],
      [502, "upstream-error"],
    ] as const) {
      const result = await probeDecisionModel({
        baseUrl: "https://example.test",
        fetchImpl: stubFetch({ error: { message: "denied" } }, status),
      });
      expect(result.outcome).toBe("failed");
      expect(result.error?.reason).toBe(reason);
      expect(result.error?.status).toBe(status);
    }
  });

  it("reports a refused connection as unreachable", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const result = await probeDecisionModel({ baseUrl: "https://example.test", fetchImpl: impl });
    expect(result.outcome).toBe("failed");
    expect(result.error?.reason).toBe("unreachable");
  });

  it("works against a local server with no key at all", async () => {
    const result = await probeDecisionModel({
      baseUrl: "http://127.0.0.1:8000",
      fetchImpl: answeringFetch("submitted"),
    });
    expect(result.outcome).toBe("ok");
  });

  it("handles responses wrapped in a result envelope (Cloudflare Workers AI)", async () => {
    const impl = stubFetch({
      result: {
        model: "@cf/cloudflare/clef",
        answers: {
          [PROBE_QUESTIONS.action]: { type: "choice", choice: "submitted" },
          [PROBE_QUESTIONS.definite]: { type: "noul", noul: 0.95 },
        },
        usage: { input_tokens: 38 },
      },
      success: true,
    });
    const result = await probeDecisionModel({
      baseUrl: "https://example.test",
      fetchImpl: impl,
    });
    expect(result.outcome).toBe("ok");
    expect(result.resolvedModel).toBe("@cf/cloudflare/clef");
    expect(result.inputTokens).toBe(38);
  });
});

describe("readBackendProbe", () => {
  it("unwraps Cloudflare Workers AI result envelopes cleanly", () => {
    const response = {
      ok: true,
      status: 200,
      url: "https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/cloudflare/clef",
      body: {
        result: {
          model: "@cf/cloudflare/clef",
          answers: {
            [PROBE_QUESTIONS.action]: { type: "choice", choice: "submitted" },
            [PROBE_QUESTIONS.definite]: { type: "noul", noul: 1.0 },
          },
          usage: { input_tokens: 45 },
        },
        success: true,
        errors: [],
        messages: [],
      },
    };

    const result = readBackendProbe(response, 150);
    expect(result.outcome).toBe("ok");
    expect(result.resolvedModel).toBe("@cf/cloudflare/clef");
    expect(result.inputTokens).toBe(45);
    expect(result.latencyMs).toBe(150);
  });

  it("reads standard flat responses without issue", () => {
    const response = {
      ok: true,
      status: 200,
      url: "https://jevmodel.org/v1/systemone",
      body: {
        model: "jev-latest",
        answers: {
          [PROBE_QUESTIONS.action]: { type: "choice", choice: "submitted" },
          [PROBE_QUESTIONS.definite]: { type: "noul", noul: 0.9 },
        },
        usage: { input_tokens: 25 },
      },
    };

    const result = readBackendProbe(response, 80);
    expect(result.outcome).toBe("ok");
    expect(result.resolvedModel).toBe("jev-latest");
    expect(result.inputTokens).toBe(25);
  });
});

describe("decisionModelLiveState", () => {
  const now = 1_000_000_000;

  it("says unconfigured when nothing is chosen", () => {
    expect(decisionModelLiveState({ configured: false }, now)).toBe("unconfigured");
  });

  it("says untested when configured but never probed", () => {
    expect(decisionModelLiveState({ configured: true }, now)).toBe("untested");
  });

  it("says working after a successful probe", () => {
    expect(
      decisionModelLiveState(
        { configured: true, lastResult: OK, observedAt: now - 1000 },
        now,
      ),
    ).toBe("working");
  });

  it("says degraded when configured and not answering — the state that matters", () => {
    // The queue is silently on the local fallback here, and a surface showing
    // "configured" would be lying about what is ranking it.
    const failed: ProbeResult = {
      outcome: "failed",
      latencyMs: 30,
      error: { reason: "unauthorized", message: "denied", status: 401 },
    };
    expect(
      decisionModelLiveState({ configured: true, lastResult: failed, observedAt: now - 1000 }, now),
    ).toBe("degraded");
  });

  it("treats a warning as degraded, not working", () => {
    expect(
      decisionModelLiveState(
        {
          configured: true,
          lastResult: { outcome: "answered-unexpectedly", latencyMs: 40 },
          observedAt: now - 1000,
        },
        now,
      ),
    ).toBe("degraded");
  });

  it("expires a green tick — providers go down", () => {
    // A stale success is not evidence about the present, and outliving an outage
    // would be worse than admitting we do not know.
    const thirtyMinutes = 30 * 60 * 1000;
    expect(
      decisionModelLiveState(
        { configured: true, lastResult: OK, observedAt: now - thirtyMinutes - 1 },
        now,
      ),
    ).toBe("untested");
    expect(
      decisionModelLiveState({ configured: true, lastResult: OK, observedAt: now - 1000 }, now),
    ).toBe("working");
  });
});
