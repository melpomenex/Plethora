import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../onDeviceAI", async () => {
  const actual = await vi.importActual<typeof import("../onDeviceAI")>("../onDeviceAI");
  return {
    ...actual,
    generateNativePrompt: vi.fn(),
    summarize: vi.fn(),
  };
});

import { generateNativePrompt, summarize } from "../onDeviceAI";
import {
  analyzeExtract,
  extractKeyPoints,
  generateStudyQuestions,
  suggestTags,
  summarizeArticle,
} from "../extractAI";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractKeyPoints", () => {
  it("parses bullet lines into clean string array", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "kp-1",
      text: "• First point\n• Second point\n* Third point",
      inputTokens: 10,
      tokenLimit: 4096,
      candidates: [],
    });

    const points = await extractKeyPoints("Sample text", 3);
    expect(points).toEqual(["First point", "Second point", "Third point"]);
  });
});

describe("generateStudyQuestions", () => {
  it("parses question lines into string array", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "sq-1",
      text: "Q: What is A?\nQ: Why does B work?",
      inputTokens: 10,
      tokenLimit: 4096,
      candidates: [],
    });

    const questions = await generateStudyQuestions("Sample text", 2);
    expect(questions).toEqual(["What is A?", "Why does B work?"]);
  });
});

describe("suggestTags", () => {
  it("cleans, lowercases, and deduplicates tags", async () => {
    vi.mocked(generateNativePrompt).mockResolvedValue({
      requestId: "tg-1",
      text: "#Biology, Science, biology, #Physiology",
      inputTokens: 10,
      tokenLimit: 4096,
      candidates: [],
    });

    const tags = await suggestTags("Sample text", ["science"]);
    expect(tags).toEqual(["biology", "physiology"]);
  });
});

describe("analyzeExtract", () => {
  it("runs subtasks independently so one failure does not block others", async () => {
    vi.mocked(summarize).mockResolvedValue("Sample summary");
    vi.mocked(generateNativePrompt).mockImplementation(async (req) => {
      if (req.text.includes("key points")) {
        throw new Error("key points failed");
      }
      return {
        requestId: req.requestId,
        text: "Q: Sample question?",
        inputTokens: 10,
        tokenLimit: 4096,
        candidates: [],
      };
    });

    const result = await analyzeExtract("Sample text");
    expect(result.summary).toBe("Sample summary");
    expect(result.keyPoints).toBeUndefined();
    expect(result.questions).toEqual(["Sample question?"]);
    expect(result.provenance).toBe("ondevice-gemini-nano");
  });
});
