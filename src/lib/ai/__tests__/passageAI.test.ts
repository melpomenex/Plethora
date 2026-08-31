/**
 * Passage adapter tests against the task-layer architecture: the adapters run
 * for real (budgeting, grounding, truncation flags, cloud disclosure seams)
 * and `runTask` executes its real pipeline. Only the provider-availability
 * boundary is faked:
 *   - `../provider` decides which `runAiAction` branch runs (on-device/cloud);
 *   - `../providers` routes to a scripted fake provider, so the on-device
 *     branch goes through the real router and real request building;
 *   - `../../../api/ai` stands in for the legacy cloud commands the
 *     `cloudExecutor`s call (design D30).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
} from "../providers/types";
import { fakeCapabilities } from "../__fixtures__/FakeAIProvider";
import { AIError } from "../errors";

const { path, routing } = vi.hoisted(() => ({
  // The real resolver is exercised by provider tests; here we drive the path.
  path: { current: "ondevice" as "ondevice" | "cloud" | "none" },
  routing: { providers: [] as AIProvider[] },
}));

vi.mock("../../../api/ai", () => ({
  answerQuestion: vi.fn(async () => "cloud answer"),
  summarizeContent: vi.fn(async () => "cloud summary"),
  simplifyContent: vi.fn(async () => "cloud simplification"),
  extractKeyPoints: vi.fn(async () => ["point one", "point two"]),
}));

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => path.current),
  prefersOnDevice: vi.fn(() => true),
  hasCloudProvider: vi.fn(() => false),
  runAiAction: vi.fn(
    async (action: { onDevice: () => Promise<unknown>; cloud: () => Promise<unknown> }) => {
      if (path.current === "none") return null;
      return path.current === "cloud" ? action.cloud() : action.onDevice();
    }
  ),
  requestCloudFallback: vi.fn(async () => true),
}));

vi.mock("../providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers")>()),
  getRoutingProviders: () => routing.providers,
}));

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

/**
 * A scripted provider that can emit exact streaming chunk boundaries (the
 * shared `FakeAIProvider` always splits a response in half, which would hide
 * the chunk contract the adapters forward to their callers).
 */
type ScriptedResponse = Error | { response: AIResponse; chunks?: string[] };

class ScriptedProvider implements AIProvider {
  readonly requests: AIRequest[] = [];
  readonly streamOptions: AIStreamOptions[] = [];
  callCount = 0;

  constructor(
    readonly id: string,
    readonly kind: "ondevice" | "cloud",
    private readonly script: ScriptedResponse[]
  ) {}

  async getCapabilities() {
    return fakeCapabilities();
  }

  generateStream(req: AIRequest, opts: AIStreamOptions = {}): Promise<AIResponse> {
    this.requests.push(req);
    this.streamOptions.push(opts);
    const entry = this.script[Math.min(this.callCount++, this.script.length - 1)];
    return new Promise<AIResponse>((resolve, reject) => {
      if (entry instanceof Error) {
        reject(entry);
        return;
      }
      for (const chunk of entry.chunks ?? (entry.response.text ? [entry.response.text] : [])) {
        opts.onChunk?.(chunk);
      }
      resolve(entry.response);
    });
  }
}

function aiResponse(text: string): AIResponse {
  return { requestId: "req-1", text, baseModelName: "gemini-nano" };
}

/** Route on-device generation to `script` and keep a cloud slot for the router. */
function installProviders(
  script: ScriptedResponse[] = [{ response: aiResponse("on-device output") }]
): ScriptedProvider {
  const onDevice = new ScriptedProvider("scripted-ondevice", "ondevice", script);
  routing.providers = [onDevice, new ScriptedProvider("scripted-cloud", "cloud", [])];
  return onDevice;
}

beforeEach(() => {
  vi.clearAllMocks();
  path.current = "ondevice";
  vi.mocked(answerQuestion).mockResolvedValue("cloud answer");
  vi.mocked(summarizeContent).mockResolvedValue("cloud summary");
  vi.mocked(simplifyContent).mockResolvedValue("cloud simplification");
  vi.mocked(extractKeyPoints).mockResolvedValue(["point one", "point two"]);
  installProviders([{ response: aiResponse("on-device output") }]);
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
    installProviders([
      {
        chunks: ["The heart ", "pumps blood."],
        response: aiResponse("The heart pumps blood."),
      },
    ]);

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
    installProviders([{ response: aiResponse("Quantum mechanics causes black holes.") }]);

    const result = await answerPassage(
      "What causes black holes?",
      "Gravity causes stellar collapse into black holes."
    );

    expect(result.grounded).toBe(false);
    expect(result.reasons).toContain("unsupported_assertion");
  });

  it("uses the cloud command and still checks grounding", async () => {
    path.current = "cloud";
    const onDevice = installProviders();
    vi.mocked(answerQuestion).mockResolvedValue("Gravity causes stellar collapse.");

    const result = await answerPassage("Why?", "Gravity causes stellar collapse.");

    expect(answerQuestion).toHaveBeenCalledWith("Why?", "Gravity causes stellar collapse.");
    expect(onDevice.callCount).toBe(0);
    expect(result.text).toBe("Gravity causes stellar collapse.");
    expect(result.grounded).toBe(true);
  });

  it("does not fall back when the on-device request is cancelled", async () => {
    installProviders([new AIError("Cancelled", "aborted", { code: "cancelled" })]);

    await expect(answerPassage("Why?", "Some passage.")).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(answerQuestion).not.toHaveBeenCalled();
  });
});

describe("explainPassage", () => {
  it("generates a simple explanation by default", async () => {
    const onDevice = installProviders();
    const result = await explainPassage("Blood flows through veins.");
    expect(result.text).toBe("on-device output");
    expect(result.truncated).toBe(false);
    expect(onDevice.requests[0]).toMatchObject({
      systemInstruction: expect.stringContaining("Explain the core concepts"),
      maxOutputTokens: 192,
    });
  });

  it("supports detailed and study-note presets", async () => {
    const onDevice = installProviders();
    await explainPassage("Sample text", { preset: "study-note" });
    expect(onDevice.requests[0]).toMatchObject({
      systemInstruction: expect.stringContaining("study card"),
      maxOutputTokens: 192,
    });

    await explainPassage("Sample text", { preset: "detailed" });
    expect(onDevice.requests[1]).toMatchObject({
      systemInstruction: expect.stringContaining("step-by-step detailed breakdown"),
      maxOutputTokens: 256,
    });
  });

  it("takes the cloud path when the resolver says cloud", async () => {
    path.current = "cloud";
    const onDevice = installProviders();
    const result = await explainPassage("Blood flows through veins.");
    expect(result.text).toBe("cloud answer");
    expect(onDevice.callCount).toBe(0);
  });

  it("marks the result truncated when the passage exceeds the budget", async () => {
    installProviders();
    // Two paragraphs, each far over the 1000-token floor (~4000 chars).
    const paragraph = "word ".repeat(1200);
    const result = await explainPassage(`${paragraph}\n\n${paragraph}`);
    expect(result.truncated).toBe(true);
  });
});

describe("summarizePassage", () => {
  it("uses the streaming prompt on-device for progressive streaming", async () => {
    const onDevice = installProviders();
    const result = await summarizePassage("Some long passage.");
    expect(onDevice.requests[0]).toMatchObject({
      systemInstruction: expect.stringContaining("Summarize the key points"),
      maxOutputTokens: 192,
    });
    expect(onDevice.streamOptions[0].stream).toBe(true);
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
    const onDevice = installProviders();
    await simplifyPassage("Dense text.");
    expect(onDevice.requests[0]).toMatchObject({
      systemInstruction: expect.stringContaining("plain language"),
    });
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
    const onDevice = installProviders();
    await keyTermsPassage("Dense text.");
    expect(onDevice.requests[0]).toMatchObject({
      systemInstruction: expect.stringContaining("most important terms"),
    });
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
