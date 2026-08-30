import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalNemotronProvider } from "../providers/LocalNemotronProvider";
import { buildRoutingContextFromSettings } from "../config";
import { buildFallbackChain } from "../TranscriptionRouter";

import { TRANSCRIPTION_PROVIDER_IDS } from "../config";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
}));

vi.mock("../../../api/transcription", () => ({
  isLocalNemotronInstalled: vi.fn(async () => true),
  transcribeLocalNemotron: vi.fn(async () => ({
    id: 1,
    status: "complete",
    segments: [{ start_ms: 0, end_ms: 1000, text: "hello", confidence: 1 }],
  })),
}));

describe("LocalNemotronProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis.navigator, "hardwareConcurrency", {
      configurable: true,
      value: 8,
    });
    Object.defineProperty(globalThis.navigator, "deviceMemory", {
      configurable: true,
      value: 16,
    });
  });

  it("uses shared logical model key", async () => {
    const provider = new LocalNemotronProvider();
    const result = await provider.transcribe({ filePath: "/tmp/clip.wav" }, { language: "en" });
    expect(result.providerId).toBe("local:nemotron-3.5");
    expect(result.model).toBe("nemotron-3.5-asr-0.6b");
  });

  it("is preferred in automatic chain when installed and preferLocal", () => {
    const context = buildRoutingContextFromSettings(
      {
        provider: "local",
        mode: "auto",
        sttProvider: "automatic",
        preferLocal: true,
        automaticFallback: true,
      },
      { localNemotronInstalled: true },
    );
    const chain = buildFallbackChain(context);
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
  });
});
