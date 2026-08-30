import { describe, expect, it } from "vitest";
import {
  buildFallbackChain,
  canFallbackToProvider,
} from "../TranscriptionRouter";
import { TranscriptionMode } from "../types";
import {
  LOGICAL_STT_MODEL_KEYS,
  TRANSCRIPTION_PROVIDER_IDS,
  buildRoutingContextFromSettings,
} from "../config";

describe("STT routing matrix", () => {
  it("automatic + preferLocal + installed → local Nemotron first", () => {
    const chain = buildFallbackChain(
      buildRoutingContextFromSettings(
        { provider: "local", sttProvider: "automatic", preferLocal: true },
        { localNemotronInstalled: true },
      ),
    );
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
  });

  it("explicit openrouter skips local Nemotron", () => {
    const chain = buildFallbackChain(
      buildRoutingContextFromSettings(
        { provider: "groq", sttProvider: "openrouter", preferLocal: true },
        { localNemotronInstalled: true },
      ),
    );
    expect(chain).not.toContain(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON);
  });

  it("local provider category is offline-only", () => {
    const chain = buildFallbackChain(
      buildRoutingContextFromSettings(
        { provider: "local", sttProvider: "local" },
        { localNemotronInstalled: true },
      ),
    );
    expect(chain.every((id) => id.startsWith("local:"))).toBe(true);
  });

  it("automatic fallback off limits explicit model chain", () => {
    const chain = buildFallbackChain({
      mode: TranscriptionMode.Fast,
      sttProvider: "openrouter",
      sttModel: LOGICAL_STT_MODEL_KEYS.QWEN_17,
      automaticFallback: false,
      preferLocal: false,
    });
    expect(chain).toEqual([TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_17]);
  });

  it("blocks inexpensive → premium silent escalation", () => {
    const allowed = canFallbackToProvider(
      TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON,
      TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
      { mode: TranscriptionMode.Auto, allowPremiumFallback: false },
    );
    expect(allowed).toBe(false);
  });

  it("premium mode allows premium providers", () => {
    const chain = buildFallbackChain(
      buildRoutingContextFromSettings({ provider: "groq", sttProvider: "premium" }),
    );
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE);
  });
});
