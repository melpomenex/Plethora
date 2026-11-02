import { beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "./fixtures/completions.json";
import { chatWithLLM } from "../index";
import { parseAnthropicCompletion, parseOpenAICompletion } from "../response";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../../lib/tauri", () => ({ invokeCommand: invoke, listen: vi.fn() }));

describe("LLM transport response normalization", () => {
  beforeEach(() => invoke.mockReset());
  it.each(["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"])("normalizes output-limit reason %s", async finish_reason => {
    invoke.mockResolvedValue({ content: "", finish_reason });
    expect((await chatWithLLM({ provider: "openai", messages: [] })).finishReason).toBe("length");
  });
  for (const fixture of fixtures) {
    it(`extracts only final text from HTTP: ${fixture.name}`, () => {
      expect(parseOpenAICompletion(fixture.upstream)).toEqual(fixture.canonical);
    });
    it(`normalizes native wire metadata: ${fixture.name}`, async () => {
      invoke.mockResolvedValue(fixture.native);
      const result = await chatWithLLM({ provider: "openai", messages: [] });
      expect(result).toEqual(fixture.canonical);
    });
    it(`accepts browser wire metadata: ${fixture.name}`, async () => {
      invoke.mockResolvedValue(fixture.canonical);
      expect(await chatWithLLM({ provider: "openai", messages: [] })).toEqual(fixture.canonical);
    });
  }
  it("preserves all Anthropic text parts and no thinking/tool payloads", () => {
    expect(
      parseAnthropicCompletion({
        content: [
          { type: "thinking", thinking: "PRIVATE" },
          { type: "text", text: "hello" },
          { type: "text", text: " world" },
        ],
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 20 },
      })
    ).toEqual({
      content: "hello world",
      responseKind: "final-text",
      finishReason: "length",
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });
    for (const [type, responseKind] of [
      ["tool_use", "tool-only"],
      ["thinking", "reasoning-only"],
    ]) {
      expect(parseAnthropicCompletion({ content: [{ type, text: "PRIVATE" }] })).toMatchObject({
        content: "",
        responseKind,
      });
    }
    expect(parseAnthropicCompletion({ content: [], stop_reason: "refusal" })).toMatchObject({
      content: "",
      responseKind: "refusal",
    });
  });
  it("keeps old runtimes without metadata compatible", async () => {
    invoke.mockResolvedValue({ content: "{}" });
    expect(await chatWithLLM({ provider: "openai", messages: [] })).toEqual({ content: "{}" });
  });
  it("forwards task-owned recovery and leaves omitted flags compatible", async () => {
    invoke.mockResolvedValue({ content: "{}" });
    await chatWithLLM({ provider: "openai", messages: [], taskManagedRecovery: true });
    expect(invoke.mock.calls[0][1].taskManagedRecovery).toBe(true);
    await chatWithLLM({ provider: "openai", messages: [] });
    expect(invoke.mock.calls[1][1].taskManagedRecovery).toBeUndefined();
  });
});
