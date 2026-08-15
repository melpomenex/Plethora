import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTask, parseStrictJson, getInFlightTaskCount } from "../tasks/runTask";
import { clearTaskRegistry, registerTask } from "../tasks/registry";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../tasks/containment";
import { PREREQUISITE_ANALYSIS_SCHEMA } from "../schemas/prerequisite";
import { clearTaskDiagnostics, getTaskDiagnostics } from "../diagnostics";
import { AIError } from "../errors";
import type { AITaskDefinition, ValidationOutcome } from "../tasks/types";
import type { PrerequisiteAnalysis } from "../schemas/prerequisite";

function textTask(overrides: Partial<AITaskDefinition<{ q: string }, string>> = {}): AITaskDefinition<
  { q: string },
  string
> {
  return {
    id: `text-${Math.random().toString(36).slice(2, 7)}`,
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nAnswer briefly.`,
    buildInput: (input) => ({ text: `Question: ${input.q}` }),
    outputKind: "text",
    maxOutputTokens: 128,
    timeoutMs: 5000,
    ...overrides,
  };
}

function structuredTask(
  overrides: Partial<AITaskDefinition<{ src: string }, PrerequisiteAnalysis>> = {}
): AITaskDefinition<{ src: string }, PrerequisiteAnalysis> {
  return {
    id: `struct-${Math.random().toString(36).slice(2, 7)}`,
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nPropose prerequisites.`,
    buildInput: (input) => ({ text: `<untrusted_source id="src">\n${input.src}\n</untrusted_source>` }),
    outputKind: "structured",
    schema: PREREQUISITE_ANALYSIS_SCHEMA as AITaskDefinition<
      { src: string },
      PrerequisiteAnalysis
    >["schema"],
    validate: (output): ValidationOutcome<PrerequisiteAnalysis> => {
      if (
        typeof output === "object" &&
        output !== null &&
        Array.isArray((output as { prerequisites?: unknown }).prerequisites)
      ) {
        const arr = (output as { prerequisites: unknown[] }).prerequisites;
        if (
          arr.every(
            (e) =>
              typeof e === "object" &&
              e !== null &&
              typeof (e as { concept?: unknown }).concept === "string" &&
              typeof (e as { why?: unknown }).why === "string"
          )
        ) {
          return { ok: true, value: output as PrerequisiteAnalysis };
        }
      }
      return { ok: false, errors: ["prerequisites: malformed entries"] };
    },
    maxOutputTokens: 512,
    timeoutMs: 5000,
    ...overrides,
  };
}

function aiResponse(text: string, extra: Record<string, unknown> = {}) {
  return { requestId: "r", text, ...extra };
}

beforeEach(() => {
  clearTaskRegistry();
  clearTaskDiagnostics();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("text tasks through runTask", () => {
  it("streams output and returns metadata", async () => {
    const provider = new FakeAIProvider({
      responses: [aiResponse("hello world", { baseModelName: "gemini-nano" })],
    });
    const chunks: string[] = [];
    const result = await runTask(textTask(), { q: "hi" }, {
      provider,
      onChunk: (c) => chunks.push(c),
    });

    expect(result.output).toBe("hello world");
    expect(result.text).toBe("hello world");
    expect(result.baseModelName).toBe("gemini-nano");
    expect(result.providerId).toBe(provider.id);
    expect(result.validationOutcome).toBe("text");
    // Fake provider emits two chunks at the midpoint.
    expect(chunks).toEqual(["hello", " world"]);
  });

  it("sends the static system instruction and task input to the provider", async () => {
    const provider = new FakeAIProvider({ responses: [aiResponse("ok")] });
    const task = textTask();
    await runTask(task, { q: "why?" }, { provider });
    expect(provider.requests[0].systemInstruction).toContain(UNTRUSTED_CONTAINMENT_CLAUSE);
    expect(provider.requests[0].text).toContain("Question: why?");
    expect(provider.requests[0].maxOutputTokens).toBe(128);
  });

  it("rejects oversized inputs against the provider context (estimation only)", async () => {
    const provider = new FakeAIProvider({
      capabilities: { contextTokens: 1000 },
      responses: [aiResponse("x")],
    });
    const big = "word ".repeat(1200); // ~1500 tokens
    await expect(
      runTask(textTask({ maxOutputTokens: 256 }), { q: big }, { provider })
    ).rejects.toMatchObject({ category: "InputTooLarge", code: "context_too_large" });
    expect(provider.requests).toHaveLength(0);
  });

  it("skips the budget gate for pre-budgeted tasks", async () => {
    const provider = new FakeAIProvider({
      capabilities: { contextTokens: 1000 },
      responses: [aiResponse("x")],
    });
    const big = "word ".repeat(1200);
    const result = await runTask(
      textTask({ budgetPolicy: "pre-budgeted" }),
      { q: big },
      { provider }
    );
    expect(result.output).toBe("x");
  });

  it("gates vision tasks without the vision capability", async () => {
    const provider = new FakeAIProvider({
      capabilities: { vision: false },
      responses: [aiResponse("x")],
    });
    const task = textTask({
      requiresVision: true,
      buildInput: () => ({ text: "describe", image: { mimeType: "image/png", data: "aGk=" } }),
    });
    await expect(runTask(task, { q: "x" }, { provider })).rejects.toMatchObject({
      category: "VisionUnavailable",
    });
    expect(provider.requests).toHaveLength(0);
  });

  it("propagates cancellation as Cancelled", async () => {
    const provider = new FakeAIProvider({
      responses: [
        new AIError("Cancelled", "user cancelled", { code: "cancelled" }),
      ],
    });
    await expect(runTask(textTask(), { q: "x" }, { provider })).rejects.toMatchObject({
      category: "Cancelled",
    });
  });

  it("fails with a timeout category when the task exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    const provider = new FakeAIProvider({
      responses: [
        (_req, _call) =>
          new Promise(() => {
            /* never resolves */
          }),
      ],
    });
    const attempt = runTask(textTask({ timeoutMs: 50 }), { q: "x" }, { provider });
    // Flush microtasks so the timeout timer and abort listener are installed.
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(60);
    await expect(attempt).rejects.toMatchObject({ category: "GenerationFailed", code: "timeout" });
  });

  it("coalesces duplicate concurrent runs on the same target", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = new FakeAIProvider({
      responses: [
        async () => {
          await gate;
          return aiResponse("shared");
        },
      ],
    });
    const task = textTask();

    const a = runTask(task, { q: "same" }, { provider, targetId: "target-1" });
    const b = runTask(task, { q: "same" }, { provider, targetId: "target-1" });
    expect(getInFlightTaskCount()).toBe(1);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.output).toBe("shared");
    expect(rb.output).toBe("shared");
    expect(provider.callCount).toBe(1);
    expect(getInFlightTaskCount()).toBe(0);
  });

  it("does not coalesce different targets", async () => {
    const provider = new FakeAIProvider({ responses: [aiResponse("a"), aiResponse("b")] });
    const task = textTask();
    const [ra, rb] = await Promise.all([
      runTask(task, { q: "one" }, { provider, targetId: "t1" }),
      runTask(task, { q: "two" }, { provider, targetId: "t2" }),
    ]);
    expect(provider.callCount).toBe(2);
    expect([ra.output, rb.output].sort()).toEqual(["a", "b"]);
  });

  it("uses a legacy cloudExecutor when the provider kind is cloud", async () => {
    const provider = new FakeAIProvider({ kind: "cloud", responses: [aiResponse("ignored")] });
    const cloudExecutor = vi.fn(async () => ({ text: "legacy cloud result", baseModelName: "gpt" }));
    const task = textTask({ cloudExecutor });
    const result = await runTask(task, { q: "x" }, { provider });
    expect(cloudExecutor).toHaveBeenCalledWith({ q: "x" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(result.output).toBe("legacy cloud result");
    expect(result.providerKind).toBe("cloud");
    expect(provider.requests).toHaveLength(0);
  });
});

describe("structured output pipeline (design D5)", () => {
  it("uses the native structured payload without JSON prompting when available", async () => {
    const provider = new FakeAIProvider({
      capabilities: { structuredGeneration: true },
      responses: [
        aiResponse('{"prerequisites":[]}', { structured: { prerequisites: [] } }),
      ],
    });
    const task = structuredTask();
    const result = await runTask(task, { src: "source" }, { provider });

    expect(result.output).toEqual({ prerequisites: [] });
    expect(result.validationOutcome).toBe("native-structured");
    expect(provider.requests[0].structured).toBe(true);
    expect(provider.requests[0].schemaName).toBe("prerequisiteAnalysis");
    expect(provider.requests[0].systemInstruction).not.toContain("JSON");
    expect(provider.callCount).toBe(1);
  });

  it("falls back to strict-JSON prompt mode when structured is unavailable", async () => {
    const provider = new FakeAIProvider({
      responses: [aiResponse('{"prerequisites":[{"concept":"A","why":"basis"}]}')],
    });
    const task = structuredTask();
    const result = await runTask(task, { src: "source" }, { provider });

    expect(result.output.prerequisites).toEqual([{ concept: "A", why: "basis" }]);
    expect(result.validationOutcome).toBe("strict-json");
    expect(provider.requests[0].structured).toBe(false);
    expect(provider.requests[0].systemInstruction).toContain("ONLY a single JSON value");
    expect(provider.requests[0].systemInstruction).toContain("prerequisites");
  });

  it("parses fenced JSON", async () => {
    const provider = new FakeAIProvider({
      responses: [aiResponse('```json\n{"prerequisites":[]}\n```')],
    });
    const result = await runTask(structuredTask(), { src: "s" }, { provider });
    expect(result.output).toEqual({ prerequisites: [] });
    expect(result.validationOutcome).toBe("strict-json");
  });

  it("repairs once when the first response fails validation, then succeeds", async () => {
    const provider = new FakeAIProvider({
      responses: [
        aiResponse('{"prerequisites": "none"}'), // parseable but invalid
        aiResponse('{"prerequisites":[{"concept":"B","why":"needed"}]}'),
      ],
    });
    const task = structuredTask();
    const result = await runTask(task, { src: "s" }, { provider });

    expect(result.validationOutcome).toBe("repaired");
    expect(result.output.prerequisites[0].concept).toBe("B");
    expect(provider.callCount).toBe(2);
    // The repair request carries the validation error.
    expect(provider.requests[1].text).toContain("rejected by validation");
    expect(provider.requests[1].text).toContain("malformed entries");
  });

  it("fails closed with InvalidStructuredOutput after one failed repair", async () => {
    const provider = new FakeAIProvider({
      responses: [
        aiResponse("garbage prose"),
        aiResponse("still garbage"),
      ],
    });
    const task = structuredTask();
    await expect(runTask(task, { src: "s" }, { provider })).rejects.toMatchObject({
      category: "InvalidStructuredOutput",
      code: "invalid_structured_output",
    });
    expect(provider.callCount).toBe(2); // exactly one repair retry
  });

  it("fails closed when validation rejects a parseable payload twice", async () => {
    const provider = new FakeAIProvider({
      responses: [
        aiResponse('{"prerequisites": "none"}'), // parseable but invalid
        aiResponse('{"prerequisites": 42}'),
      ],
    });
    await expect(runTask(structuredTask(), { src: "s" }, { provider })).rejects.toMatchObject({
      category: "InvalidStructuredOutput",
    });
  });

  it("repairs an invalid native structured payload via text mode", async () => {
    const provider = new FakeAIProvider({
      capabilities: { structuredGeneration: true },
      responses: [
        aiResponse('{"prerequisites": "bad"}', { structured: { prerequisites: "bad" } }),
        aiResponse('{"prerequisites":[]}'),
      ],
    });
    const result = await runTask(structuredTask(), { src: "s" }, { provider });
    expect(result.validationOutcome).toBe("repaired");
    expect(provider.requests[1].structured).toBe(false);
  });

  it("strict-JSON mode handles a native structured null without erroring", async () => {
    const provider = new FakeAIProvider({
      capabilities: { structuredGeneration: true },
      responses: [aiResponse('{"prerequisites":[]}', { structured: null })],
    });
    const result = await runTask(structuredTask(), { src: "s" }, { provider });
    expect(result.validationOutcome).toBe("strict-json");
  });
});

describe("diagnostics emission (design D8)", () => {
  it("records task metadata without user content on success", async () => {
    const provider = new FakeAIProvider({ responses: [aiResponse("out")] });
    const task = textTask({ id: "diag-task", taskType: "passage-qa" });
    await runTask(task, { q: "SECRET QUESTION TEXT" }, { provider, targetId: "t" });

    const entries = getTaskDiagnostics();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.taskId).toBe("diag-task");
    expect(entry.taskType).toBe("passage-qa");
    expect(entry.modelClass).toBe("full");
    expect(entry.providerId).toBe(provider.id);
    expect(entry.validationOutcome).toBe("text");
    expect(entry.capabilityHash).toBeTruthy();
    expect(entry.retrievalCount).toBe(0);
    expect(entry.chunkIds).toEqual([]);
    // No-user-content rule.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("SECRET QUESTION TEXT");
    expect(serialized).not.toContain("out"); // no completion text either
  });

  it("records validation outcome and error category for failed structured tasks", async () => {
    const provider = new FakeAIProvider({
      responses: [aiResponse("junk"), aiResponse("junk")],
    });
    const task = structuredTask({ id: "diag-struct" });
    await expect(runTask(task, { src: "SECRET SOURCE" }, { provider })).rejects.toBeInstanceOf(
      AIError
    );
    const entry = getTaskDiagnostics()[0];
    expect(entry.taskId).toBe("diag-struct");
    expect(entry.validationOutcome).toBe("invalid-structured-output");
    expect(entry.errorCategory).toBe("InvalidStructuredOutput");
    expect(JSON.stringify(entry)).not.toContain("SECRET SOURCE");
  });

  it("records retrieval provenance when provided", async () => {
    const provider = new FakeAIProvider({ responses: [aiResponse("ok")] });
    await runTask(textTask(), { q: "x" }, {
      provider,
      retrieval: { count: 3, chunkIds: ["c1", "c2", "c3"] },
    });
    const entry = getTaskDiagnostics()[0];
    expect(entry.retrievalCount).toBe(3);
    expect(entry.chunkIds).toEqual(["c1", "c2", "c3"]);
  });
});

describe("parseStrictJson", () => {
  it("accepts bare and fenced JSON", () => {
    expect(parseStrictJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseStrictJson('```json\n[1,2]\n```')).toEqual({ ok: true, value: [1, 2] });
  });
  it("rejects prose, empty, and invalid JSON", () => {
    expect(parseStrictJson("hello").ok).toBe(false);
    expect(parseStrictJson("").ok).toBe(false);
    expect(parseStrictJson("{nope").ok).toBe(false);
  });
});
