import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIError } from "../errors";
import { runChunkedGeneration } from "../apple/foundation";
import { AppleFoundationProvider } from "../providers/appleFoundationProvider";
import { useSettingsStore } from "../../../stores/settingsStore";

const fm = vi.hoisted(() => ({
  generate: vi.fn(async (args: { text: string; requestId: string }) => ({
    requestId: args.requestId,
    text: `out:${args.text.slice(0, 12)}`,
  })),
  availability: vi.fn(async () => ({ status: "available", tokenLimit: 4096 })),
  snapshot: vi.fn(async () => ({
    appleOs: true,
    foundationModels: { status: "available" as const },
    speech: { status: "unavailable" as const },
    visionDocuments: { status: "unavailable" as const },
    spotlightSemantic: { status: "unavailable" as const },
    naturalLanguageEmbeddings: { status: "unavailable" as const },
    coreAi: { status: "unavailable" as const },
    checkedAt: 1,
  })),
}));

vi.mock("../apple/plugin", () => ({
  invokeApple: (cmd: string, args?: { payload?: { text?: string; requestId?: string } }) => {
    if (cmd === "apple_fm_generate") {
      return fm.generate({
        requestId: args?.payload?.requestId ?? "r",
        text: args?.payload?.text ?? "",
      });
    }
    if (cmd === "apple_fm_availability") return fm.availability();
    if (cmd === "apple_fm_count_tokens") {
      return { inputTokens: 8, tokenLimit: 4096 };
    }
    if (cmd === "apple_fm_cancel" || cmd === "apple_fm_warmup") return { ok: true };
    return {};
  },
}));

vi.mock("../apple/capabilities", () => ({
  getAppleIntelligenceSnapshot: () => fm.snapshot(),
  isAppleOsPlatform: () => true,
}));

describe("AppleFoundationProvider", () => {
  beforeEach(() => {
    fm.generate.mockClear();
    useSettingsStore.setState((s) => ({
      ...s,
      settings: {
        ...s.settings,
        features: { ...s.settings.features, appleFoundationModels: true },
      },
    }));
  });

  it("falls back to 4096 context tokens", async () => {
    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.contextTokens).toBe(4096);
  });

  it("uses native contextSize when present", async () => {
    fm.availability.mockResolvedValueOnce({
      status: "available",
      contextSize: 8192,
    });
    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.contextTokens).toBe(8192);
  });

  it("maps availability table statuses", async () => {
    fm.snapshot.mockResolvedValueOnce({
      ...(await fm.snapshot()),
      foundationModels: { status: "unavailable", reason: "unsupported_os" },
    });
    fm.availability.mockResolvedValueOnce({ status: "unavailable", reason: "unsupported_os" });
    const caps = await new AppleFoundationProvider().getCapabilities();
    expect(caps.textGeneration).toBe(false);
  });

  it("rejects cancelled requests before generate", async () => {
    const provider = new AppleFoundationProvider();
    const signal = AbortSignal.abort();
    await expect(
      provider.generateStream({ requestId: "c", text: "hi" }, { signal }),
    ).rejects.toMatchObject({ category: "Cancelled" });
    expect(fm.generate).not.toHaveBeenCalled();
  });
});

describe("runChunkedGeneration", () => {
  it("map-reduces long text into multiple native calls", async () => {
    const long = "word ".repeat(4000);
    const result = await runChunkedGeneration(
      { requestId: "long", text: long },
      2000,
    );
    expect(fm.generate.mock.calls.length).toBeGreaterThan(1);
    expect(result.text).toBeTruthy();
  });

  it("does not slice libraryAnswer into citation units", async () => {
    fm.generate.mockClear();
    const text = "chunk-a ".repeat(4000);
    await expect(
      runChunkedGeneration(
        { requestId: "lib", text, schemaName: "libraryAnswer" },
        500,
      ),
    ).rejects.toBeInstanceOf(AIError);
    expect(fm.generate).not.toHaveBeenCalled();
  });
});
