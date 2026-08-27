import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithContext } from "../index";

const { mockInvokeCommand } = vi.hoisted(() => ({ mockInvokeCommand: vi.fn() }));

vi.mock("../../../lib/tauri", () => ({
  invokeCommand: mockInvokeCommand,
  listen: vi.fn(),
}));

describe("chatWithContext policy fields", () => {
  beforeEach(() => {
    mockInvokeCommand.mockReset();
    mockInvokeCommand.mockResolvedValue({ content: "ok" });
  });

  it("sends separate configured context, prompt budget, and max output", async () => {
    await chatWithContext(
      "ollama",
      "llama3.2",
      [{ role: "user", content: "Summarize" }],
      {
        type: "document",
        content: "Document body",
        configuredContextTokens: 16384,
        promptBudgetTokens: 12000,
        maxOutputTokens: 2048,
      },
      undefined,
      "http://localhost:11434",
      0.7,
      2048,
    );

    expect(mockInvokeCommand).toHaveBeenCalledOnce();
    const [, args] = mockInvokeCommand.mock.calls[0];
    expect(args.context.configuredContextTokens).toBe(16384);
    expect(args.context.maxOutputTokens).toBe(2048);
    expect(args.context.promptBudgetTokens).toBe(12000);
    expect(args.maxTokens).toBe(2048);
    expect(args.maxTokens).not.toBe(16384);
    expect(args.context.contextWindowTokens).not.toBe(2048);
    expect(args.policy.maxOutputTokens).toBe(2048);
    expect(args.policy.configuredContextTokens).toBe(16384);
  });

  it("does not overwrite context window with provider max output", async () => {
    await chatWithContext(
      "openai",
      "gpt-4o",
      [{ role: "user", content: "Hi" }],
      { type: "general", contextWindowTokens: 8192 },
      "sk-test",
      undefined,
      0.7,
      4096,
    );

    const [, args] = mockInvokeCommand.mock.calls[0];
    expect(args.context.maxOutputTokens).toBe(4096);
    expect(args.maxTokens).toBe(4096);
    expect(args.context.contextWindowTokens).toBe(8192);
  });

  it("treats legacy contextWindowTokens as prompt-budget hint", async () => {
    await chatWithContext(
      "ollama",
      "llama3.2",
      [{ role: "user", content: "Hi" }],
      { type: "general", contextWindowTokens: 8192 },
    );

    const [, args] = mockInvokeCommand.mock.calls[0];
    expect(args.context.promptBudgetTokens).toBeGreaterThan(0);
    expect(args.policy.maxOutputTokens).not.toBe(8192);
  });
});
