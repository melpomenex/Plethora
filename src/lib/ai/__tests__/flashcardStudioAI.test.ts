/**
 * Flashcard Studio adapter tests against the task-layer architecture: hint
 * leakage checks and the resilient explain chain run for real over `runTask`
 * output. Only the provider-availability boundary is faked — `../provider`
 * resolves the on-device path and `../providers` routes to a scripted fake
 * provider, so `runTask` builds and sends the real task requests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
} from "../providers/types";
import { fakeCapabilities } from "../__fixtures__/FakeAIProvider";

const routing = vi.hoisted(() => ({ providers: [] as AIProvider[] }));

vi.mock("../provider", () => ({
  resolveAiPath: vi.fn(async () => "ondevice"),
  prefersOnDevice: vi.fn(() => true),
  hasCloudProvider: vi.fn(() => false),
  requestCloudFallback: vi.fn(async () => true),
}));

vi.mock("../providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers")>()),
  getRoutingProviders: () => routing.providers,
}));

import { explainCard, generateReviewHint } from "../flashcardStudioAI";
import { AIError } from "../errors";

/**
 * A scripted provider that can emit exact streaming chunk boundaries (the
 * shared `FakeAIProvider` always splits a response in half, which would hide
 * the chunk contract `explainCard` forwards to its callers).
 */
type ScriptedResponse = Error | { response: AIResponse; chunks?: string[] };

class ScriptedProvider implements AIProvider {
  readonly requests: AIRequest[] = [];
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

function installProvider(script: ScriptedResponse[]): ScriptedProvider {
  const provider = new ScriptedProvider("scripted-ondevice", "ondevice", script);
  routing.providers = [provider];
  return provider;
}

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
    installProvider([
      {
        response: {
          requestId: "hint-1",
          text: "Think about the central muscular organ in the chest.",
        },
      },
    ]);

    const res = await generateReviewHint({
      question: "What pumps blood?",
      answer: "The heart",
      card_type: "qa",
    });

    expect(res.hint).toBe("Think about the central muscular organ in the chest.");
  });

  it("replaces hint if direct answer leaks in the hint text", async () => {
    installProvider([
      {
        response: { requestId: "hint-2", text: "The answer is the heart." },
      },
    ]);

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
    installProvider([
      {
        chunks: ["The heart is ", "a muscular pump."],
        response: { requestId: "explain-1", text: "The heart is a muscular pump." },
      },
    ]);

    const chunks: string[] = [];
    const res = await explainCard(
      { question: "What pumps blood?", answer: "The heart", card_type: "qa" },
      undefined,
      { onChunk: (c) => chunks.push(c) }
    );

    expect(res.explanation).toBe("The heart is a muscular pump.");
    expect(chunks).toEqual(["The heart is ", "a muscular pump."]);
  });

  it("propagates cancellation instead of retrying and resolving with fallback text", async () => {
    const aborted = new AbortController();
    aborted.abort();
    // Both attempts reject as cancelled (the second runs on the already
    // aborted signal): explainCard must re-throw, never serve the canned
    // fallback explanation for an action the user abandoned.
    const cancelled = new AIError("Cancelled", "The request was cancelled.", {
      code: "cancelled",
    });
    const provider = installProvider([cancelled, cancelled]);

    await expect(
      explainCard(
        { question: "What pumps blood?", answer: "The heart", card_type: "qa" },
        undefined,
        { signal: aborted.signal }
      )
    ).rejects.toMatchObject({ category: "Cancelled", code: "cancelled" });

    // The already-aborted signal must not be retried on the non-streaming
    // path, and the canned fallback must not be served.
    expect(provider.callCount).toBe(1);
  });
});
