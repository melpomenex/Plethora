import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    generateStreamingPrompt: vi.fn(),
    summarize: vi.fn(),
  };
});

vi.mock("../../../api/ai", () => ({
  answerQuestion: vi.fn(async () => "cloud answer"),
  summarizeContent: vi.fn(async () => "cloud summary"),
  simplifyContent: vi.fn(async () => "cloud simplification"),
  extractKeyPoints: vi.fn(async () => ["point one", "point two"]),
}));

// The real resolver is exercised by provider tests; here we drive the path.
const path = { current: "ondevice" as "ondevice" | "cloud" | "none" };

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => path.current),
  runAiAction: vi.fn(
    async (action: { onDevice: () => Promise<unknown>; cloud: () => Promise<unknown> }) => {
      if (path.current === "none") return null;
      return path.current === "cloud" ? action.cloud() : action.onDevice();
    }
  ),
}));

import { OnDeviceAiError, generateStreamingPrompt, summarize } from "../onDeviceAI";
import {
  answerQuestion,
  extractKeyPoints,
  simplifyContent,
  summarizeContent,
} from "../../../api/ai";
import {
  answerPassage,
  explainPassage,
  keyTermsPassage,
  simplifyPassage,
  summarizePassage,
} from "../passageAI";

function streamed(text: string) {
  vi.mocked(generateStreamingPrompt).mockResolvedValue({
    requestId: "req-1",
    text,
    inputTokens: 20,
    tokenLimit: 4096,
    baseModelName: "gemini-nano",
    candidates: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  path.current = "ondevice";
  vi.mocked(summarize).mockResolvedValue("on-device summary");
  vi.mocked(answerQuestion).mockResolvedValue("cloud answer");
  vi.mocked(summarizeContent).mockResolvedValue("cloud summary");
  vi.mocked(simplifyContent).mockResolvedValue("cloud simplification");
  vi.mocked(extractKeyPoints).mockResolvedValue(["point one", "point two"]);
  streamed("on-device output");
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

    expect(result.text).toBe("The heart pumps blood.");
    expect(result.grounded).toBe(true);
    expect(result.confidenceScore).toBeGreaterThan(0.5);
    expect(result.baseModelName).toBe("gemini-nano");
    expect(chunks).toEqual(["The heart ", "pumps blood."]);
  });

  it("flags unsupported assertions when answer terms are not in passage", async () => {
    streamed("Quantum mechanics causes black holes.");

    const result = await answerPassage(
      "What causes black holes?",
      "Gravity causes stellar collapse into black holes."
    );

    expect(result.grounded).toBe(false);
    expect(result.reasons).toContain("unsupported_assertion");
  });

  it("uses the cloud command and still checks grounding", async () => {
    path.current = "cloud";
    vi.mocked(answerQuestion).mockResolvedValue("Gravity causes stellar collapse.");

    const result = await answerPassage("Why?", "Gravity causes stellar collapse.");

    expect(answerQuestion).toHaveBeenCalledWith("Why?", "Gravity causes stellar collapse.");
    expect(generateStreamingPrompt).not.toHaveBeenCalled();
    expect(result.text).toBe("Gravity causes stellar collapse.");
    expect(result.grounded).toBe(true);
  });

  it("does not fall back when the on-device request is cancelled", async () => {
    vi.mocked(generateStreamingPrompt).mockRejectedValue(
      new OnDeviceAiError("cancelled", "aborted")
    );

    await expect(answerPassage("Why?", "Some passage.")).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});

describe("explainPassage", () => {
  it("generates a simple explanation by default", async () => {
    const result = await explainPassage("Blood flows through veins.");
    expect(result.text).toBe("on-device output");
    expect(result.truncated).toBe(false);
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Explain the core concepts"),
        maxOutputTokens: 192,
      }),
      expect.anything()
    );
  });

  it("supports detailed and study-note presets", async () => {
    await explainPassage("Sample text", { preset: "study-note" });
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("study card"),
        maxOutputTokens: 192,
      }),
      expect.anything()
    );

    await explainPassage("Sample text", { preset: "detailed" });
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("step-by-step detailed breakdown"),
        maxOutputTokens: 256,
      }),
      expect.anything()
    );
  });

  it("takes the cloud path when the resolver says cloud", async () => {
    path.current = "cloud";
    const result = await explainPassage("Blood flows through veins.");
    expect(result.text).toBe("cloud answer");
    expect(generateStreamingPrompt).not.toHaveBeenCalled();
  });

  it("marks the result truncated when the passage exceeds the budget", async () => {
    // Two paragraphs, each far over the 1000-token floor (~4000 chars).
    const paragraph = "word ".repeat(1200);
    const result = await explainPassage(`${paragraph}\n\n${paragraph}`);
    expect(result.truncated).toBe(true);
  });
});

describe("summarizePassage", () => {
  it("uses the streaming prompt on-device for progressive streaming", async () => {
    const result = await summarizePassage("Some long passage.");
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Summarize the key points"),
        maxOutputTokens: 192,
      }),
      expect.anything()
    );
    expect(result.text).toBe("on-device output");
  });

  it("uses summarizeContent on the cloud path", async () => {
    path.current = "cloud";
    const result = await summarizePassage("Some long passage.", { maxWords: 50 });
    expect(summarizeContent).toHaveBeenCalledWith("Some long passage.", 50);
    expect(result.text).toBe("cloud summary");
  });
});

describe("simplifyPassage", () => {
  it("prompts on-device", async () => {
    await simplifyPassage("Dense text.");
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("plain language") }),
      expect.anything()
    );
  });

  it("uses simplifyContent on the cloud path", async () => {
    path.current = "cloud";
    const result = await simplifyPassage("Dense text.", { level: "elementary" });
    expect(simplifyContent).toHaveBeenCalledWith("Dense text.", "elementary");
    expect(result.text).toBe("cloud simplification");
  });
});

describe("keyTermsPassage", () => {
  it("prompts on-device", async () => {
    await keyTermsPassage("Dense text.");
    expect(generateStreamingPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("most important terms") }),
      expect.anything()
    );
  });

  it("renders cloud key points as a bulleted list", async () => {
    path.current = "cloud";
    const result = await keyTermsPassage("Dense text.", { count: 2 });
    expect(extractKeyPoints).toHaveBeenCalledWith("Dense text.", 2);
    expect(result.text).toBe("- point one\n- point two");
  });
});

describe("no available path", () => {
  it("throws model_unavailable instead of returning nothing", async () => {
    path.current = "none";
    await expect(explainPassage("Some text.")).rejects.toMatchObject({
      code: "model_unavailable",
    });
  });
});
