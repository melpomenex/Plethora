import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    generateStreamingPrompt: vi.fn(),
    generateNativePrompt: vi.fn(),
  };
});

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => "ondevice"),
  runAiAction: vi.fn(async (action: { onDevice: () => Promise<unknown> }) => action.onDevice()),
}));

import { generateNativePrompt, generateStreamingPrompt } from "../onDeviceAI";
import { answerPassage, explainPassage } from "../passageAI";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("answerPassage", () => {
  it("rejects empty question or passage", async () => {
    await expect(answerPassage("", "Passage text")).rejects.toMatchObject({
      code: "invalid_argument",
    });
    await expect(answerPassage("Question", "   ")).rejects.toMatchObject({
      code: "invalid_argument",
    });
  });

  it("streams answer chunks and calculates grounding", async () => {
    vi.mocked(generateStreamingPrompt).mockImplementation(async (request, options) => {
      options?.onChunk?.("The heart ");
      options?.onChunk?.("pumps blood.");
      return {
        requestId: request.requestId,
        text: "The heart pumps blood.",
        inputTokens: 20,
        tokenLimit: 4096,
        baseModelName: "gemini-nano",
        candidates: [],
      };
    });

    const chunks: string[] = [];
    const result = await answerPassage(
      "What pumps blood?",
      "The heart pumps blood throughout the human body.",
      { onChunk: (c) => chunks.push(c) }
    );

    expect(result.answer).toBe("The heart pumps blood.");
    expect(result.grounded).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
    expect(result.baseModelName).toBe("gemini-nano");
    expect(chunks).toEqual(["The heart ", "pumps blood."]);
  });

  it("flags unsupported assertions when answer terms are not in passage", async () => {
    vi.mocked(generateStreamingPrompt).mockResolvedValue({
      requestId: "req-1",
      text: "Quantum mechanics causes black holes.",
      inputTokens: 20,
      tokenLimit: 4096,
      candidates: [],
    });

    const result = await answerPassage(
      "What causes black holes?",
      "Gravity causes stellar collapse into black holes."
    );

    expect(result.grounded).toBe(false);
    expect(result.reasons).toContain("unsupported_assertion");
  });
});

describe("explainPassage", () => {
  it("generates simple explanation by default", async () => {
    vi.mocked(generateStreamingPrompt).mockResolvedValue({
      requestId: "exp-1",
      text: "This passage describes how blood flows.",
      inputTokens: 15,
      tokenLimit: 4096,
      candidates: [],
    });

    const result = await explainPassage("Blood flows through veins.");
    expect(result.preset).toBe("simple");
    expect(result.explanation).toBe("This passage describes how blood flows.");
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Explain this passage in simple"),
      }),
      expect.anything()
    );
  });

  it("supports detailed and study-note presets", async () => {
    vi.mocked(generateStreamingPrompt).mockResolvedValue({
      requestId: "exp-2",
      text: "• Term 1: definition",
      inputTokens: 15,
      tokenLimit: 4096,
      candidates: [],
    });

    const result = await explainPassage("Sample text", { preset: "study-note" });
    expect(result.preset).toBe("study-note");
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("study note"),
      }),
      expect.anything()
    );
  });
});
