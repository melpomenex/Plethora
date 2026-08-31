/**
 * Extract adapter tests against the task-layer architecture: the adapters'
 * delimited-format parsing (bullet lines, `Q:` lines, comma-separated tags)
 * runs for real over `runTask`'s output. Only the provider-availability
 * boundary is faked — `../provider` pins the on-device branch and
 * `../providers` routes to a scripted `FakeAIProvider`, so requests are built
 * by the real task definitions and dispatched by request content.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../providers/types";
import { FakeAIProvider, type FakeResponse } from "../__fixtures__/FakeAIProvider";

const routing = vi.hoisted(() => ({ providers: [] as AIProvider[] }));

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => "ondevice"),
  prefersOnDevice: vi.fn(() => true),
  hasCloudProvider: vi.fn(() => false),
  runAiAction: vi.fn(
    async (action: { onDevice: () => Promise<unknown> }) => action.onDevice()
  ),
  requestCloudFallback: vi.fn(async () => true),
}));

vi.mock("../providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers")>()),
  getRoutingProviders: () => routing.providers,
}));

import {
  analyzeExtract,
  extractKeyPoints,
  generateStudyQuestions,
  suggestTags,
} from "../extractAI";

/**
 * Script one response (or thrown `Error`) per task, keyed by a needle found
 * in that task's built request text. Needles are disjoint across the extract
 * tasks and `passageSummarizeTask` (which `analyzeExtract` also drives).
 */
function installProvider(script: Record<string, string | Error>): FakeAIProvider {
  const dispatch: FakeResponse = (req) => {
    for (const [needle, outcome] of Object.entries(script)) {
      if (req.text.includes(needle)) {
        return outcome instanceof Error
          ? outcome
          : { requestId: req.requestId, text: outcome };
      }
    }
    return new Error(`No scripted response for request: ${req.text.slice(0, 80)}`);
  };
  const provider = new FakeAIProvider({
    id: "extract-ondevice",
    kind: "ondevice",
    responses: [dispatch],
  });
  routing.providers = [provider];
  return provider;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractKeyPoints", () => {
  it("parses bullet lines into clean string array", async () => {
    installProvider({
      "core key points": "• First point\n• Second point\n* Third point",
    });

    const points = await extractKeyPoints("Sample text", 3);
    expect(points).toEqual(["First point", "Second point", "Third point"]);
  });
});

describe("generateStudyQuestions", () => {
  it("parses question lines into string array", async () => {
    installProvider({
      "study questions": "Q: What is A?\nQ: Why does B work?",
    });

    const questions = await generateStudyQuestions("Sample text", 2);
    expect(questions).toEqual(["What is A?", "Why does B work?"]);
  });
});

describe("suggestTags", () => {
  it("cleans, lowercases, and deduplicates tags", async () => {
    installProvider({
      "topic tags": "#Biology, Science, biology, #Physiology",
    });

    const tags = await suggestTags("Sample text", ["science"]);
    expect(tags).toEqual(["biology", "physiology"]);
  });
});

describe("analyzeExtract", () => {
  it("runs subtasks independently so one failure does not block others", async () => {
    installProvider({
      "Summarize the key points": "Sample summary",
      "core key points": new Error("key points failed"),
      "study questions": "Q: Sample question?",
      "topic tags": "biology, physiology",
    });

    const result = await analyzeExtract("Sample text");
    expect(result.summary).toBe("Sample summary");
    expect(result.keyPoints).toBeUndefined();
    expect(result.questions).toEqual(["Sample question?"]);
    expect(result.suggestedTags).toEqual(["biology", "physiology"]);
    expect(result.provenance).toBe("unified-router");
  });
});
