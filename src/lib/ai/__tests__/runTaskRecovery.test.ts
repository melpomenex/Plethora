import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTask } from "../tasks/runTask";
import type { AITaskDefinition } from "../tasks/types";
import { AIError } from "../errors";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { clearTaskDiagnostics, getTaskDiagnostics } from "../diagnostics";
import type { AIResponse } from "../providers/types";

const valid = JSON.stringify({ ok: true });
const response = (text: string, extra: Partial<AIResponse> = {}): AIResponse => ({
  requestId: "fixture",
  text,
  ...extra,
});
const task: AITaskDefinition<string, { ok: boolean }> = {
  id: "recovery-fixture",
  taskType: "prompt",
  modelClass: "full",
  systemInstruction: "Answer using the supplied evidence.",
  buildInput: (text) => ({ text }),
  outputKind: "structured",
  schema: { name: "test", json: '{"ok":boolean}', nativeName: "test" },
  validate: (value) =>
    typeof (value as { ok?: unknown })?.ok === "boolean"
      ? { ok: true, value: value as { ok: boolean } }
      : { ok: false, errors: ["ok must be boolean"] },
  maxOutputTokens: 512,
  timeoutMs: 5000,
};

beforeEach(clearTaskDiagnostics);
describe("single corrective allowance and terminal cause", () => {
  for (const first of [
    response(""),
    response("  ", { finishReason: "length", usage: { outputTokens: 512 } }),
    response("", { responseKind: "reasoning-only" }),
    response("", { responseKind: "tool-only" }),
    response("not JSON"),
    response('{"ok":"wrong"}'),
    response("", { structured: { ok: "wrong" } }),
    response('{"ok":', { finishReason: "length" }),
  ]) {
    it(`recovers ${JSON.stringify(first)} with exactly one correction`, async () => {
      const provider = new FakeAIProvider({
        responses: [
          first,
          response(valid, { finishReason: "stop", usage: { inputTokens: 101, outputTokens: 12 } }),
        ],
      });
      const result = await runTask(task, "EVIDENCE", { provider });
      expect(result.output).toEqual({ ok: true });
      expect(result.text).toBe(valid);
      expect(result.usage).toEqual({ inputTokens: 101, outputTokens: 12 });
      expect(provider.requests).toHaveLength(2);
      expect(
        provider.requests.every((r) => r.taskManagedRecovery && r.maxOutputTokens === 512)
      ).toBe(true);
      expect(getTaskDiagnostics().at(-1)).toMatchObject({
        attemptCount: 2,
        finishReason: "stop",
        inputTokens: 101,
        outputTokens: 12,
      });
      if (first.finishReason === "length") expect(provider.requests[1].text).toContain("CUT OFF");
    });
  }
  it("reports both empty failures and terminal metadata with no third attempt", async () => {
    const provider = new FakeAIProvider({
      responses: [
        response("", { finishReason: "length", usage: { outputTokens: 512 } }),
        response(" ", { finishReason: "stop", usage: { inputTokens: 123, outputTokens: 1 } }),
      ],
    });
    await expect(
      runTask(task, "EVIDENCE", { provider, retrieval: { count: 2, chunkIds: ["one", "two"] } })
    ).rejects.toMatchObject({
      category: "InvalidStructuredOutput",
      completion: {
        attemptCount: 2,
        firstFailureKind: "output-limit",
        terminalFailureKind: "empty-response",
        outputLimitObserved: true,
        finishReason: "stop",
        outputTokens: 1,
      },
    });
    expect(provider.requests).toHaveLength(2);
    expect(getTaskDiagnostics().at(-1)).toMatchObject({
      retrievalCount: 2,
      attemptCount: 2,
      firstFailureKind: "output-limit",
      terminalFailureKind: "empty-response",
      outputTokens: 1,
    });
  });
  for (const category of ["ProviderOffline", "SafetyBlocked", "Cancelled"] as const) {
    it(`preserves corrective ${category}`, async () => {
      const provider = new FakeAIProvider({
        responses: [
          response(""),
          new AIError(category, "PRIVATE provider error", {
            code: category === "Cancelled" ? "cancelled" : "provider_offline",
          }),
        ],
      });
      await expect(runTask(task, "EVIDENCE", { provider })).rejects.toMatchObject({
        category,
        completion: { attemptCount: 2, firstFailureKind: "empty-response" },
      });
      expect(provider.requests).toHaveLength(2);
      expect(JSON.stringify(getTaskDiagnostics())).not.toContain("PRIVATE");
    });
  }
  for (const refused of [
    response("", { responseKind: "refusal" }),
    response(valid, { finishReason: "content_filter" }),
  ]) {
    it("never corrects an explicit refusal, even if the text would validate", async () => {
      const provider = new FakeAIProvider({ responses: [refused, response(valid)] });
      await expect(runTask(task, "EVIDENCE", { provider })).rejects.toMatchObject({
        category: "SafetyBlocked",
      });
      expect(provider.requests).toHaveLength(1);
    });
  }
  it("preserves native structured success without repair", async () => {
    const provider = new FakeAIProvider({
      capabilities: { structuredGeneration: true },
      responses: [response("", { structured: { ok: true } })],
    });
    expect((await runTask(task, "EVIDENCE", { provider })).validationOutcome).toBe(
      "native-structured"
    );
    expect(provider.requests).toHaveLength(1);
  });
  it("stops correction on timeout", async () => {
    vi.useFakeTimers();
    const provider = new FakeAIProvider({ responses: [response(""), () => new Promise(() => {})] });
    const pending = runTask(task, "EVIDENCE", { provider, timeoutMs: 25 });
    const assertion = expect(pending).rejects.toMatchObject({
      category: "GenerationFailed",
      code: "timeout",
      completion: { terminalFailureKind: "timeout", attemptCount: 2 },
    });
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
    expect(provider.requests).toHaveLength(2);
    vi.useRealTimers();
  });
});
