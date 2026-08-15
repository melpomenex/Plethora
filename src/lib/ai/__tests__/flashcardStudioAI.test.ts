import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    generateNativePrompt: vi.fn(),
    generateStreamingPrompt: vi.fn(),
  };
});

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => "ondevice"),
  prefersOnDevice: vi.fn(() => true),
  hasCloudProvider: vi.fn(() => false),
}));

import { generateNativePrompt, generateStreamingPrompt } from "../onDeviceAI";
import { explainCard, generateReviewHint } from "../flashcardStudioAI";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateReviewHint", () => {
  it("rejects empty question or answer", async () => {
    await expect(
      generateReviewHint({ question: "", answer: "Answer", card_type: "qa" })
    ).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("returns subtle hint when no leakage occurs", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "hint-1",
      text: "Think about the central muscular organ in the chest.",
      inputTokens: 10,
      tokenLimit: 4096,
      candidates: [],
    });

    const res = await generateReviewHint({
      question: "What pumps blood?",
      answer: "The heart",
      card_type: "qa",
    });

    expect(res.hint).toBe("Think about the central muscular organ in the chest.");
  });

  it("replaces hint if direct answer leaks in the hint text", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "hint-2",
      text: "The answer is the heart.",
      inputTokens: 10,
      tokenLimit: 4096,
      candidates: [],
    });

    const res = await generateReviewHint({
      question: "What pumps blood?",
      answer: "the heart",
      card_type: "qa",
    });

    expect(res.hint).not.toContain("the heart");
    expect(res.hint).toBe("Think about the key concepts introduced in this topic.");
  });
});

describe("explainCard", () => {
  it("streams explanation for a flashcard", async () => {
    vi.mocked(generateStreamingPrompt).mockImplementation(async (req, opts) => {
      opts?.onChunk?.("The heart is ");
      opts?.onChunk?.("a muscular pump.");
      return {
        requestId: req.requestId,
        text: "The heart is a muscular pump.",
        inputTokens: 10,
        tokenLimit: 4096,
        candidates: [],
      };
    });

    const chunks: string[] = [];
    const res = await explainCard(
      { question: "What pumps blood?", answer: "The heart", card_type: "qa" },
      undefined,
      { onChunk: (c) => chunks.push(c) }
    );

    expect(res.explanation).toBe("The heart is a muscular pump.");
    expect(chunks).toEqual(["The heart is ", "a muscular pump."]);
  });
});
