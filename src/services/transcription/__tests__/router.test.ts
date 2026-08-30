import { describe, expect, it } from "vitest";
import {
  getDefaultProviderChains,
  INEXPENSIVE_CLOUD_PROVIDER_IDS,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import {
  buildFallbackChain,
  canFallbackToProvider,
} from "../TranscriptionRouter";
import { TranscriptionMode } from "../types";

function context(
  partial: Parameters<typeof buildFallbackChain>[0],
) {
  return partial;
}

describe("TranscriptionRouter", () => {
  it("routes automatic mode to Nemotron first", () => {
    const chain = buildFallbackChain(context({ mode: TranscriptionMode.Auto }));
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON);
  });

  it("routes fast mode to Nemotron first", () => {
    const chain = buildFallbackChain(context({ mode: TranscriptionMode.Fast }));
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON);
  });

  it("routes offline mode to local providers only", () => {
    const chain = buildFallbackChain(context({ mode: TranscriptionMode.Offline }));
    expect(chain).toContain(TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER);
    expect(chain.every((id) => id.startsWith("local:"))).toBe(true);
  });

  it("routes enhanced mode to the Gemini transcribe stub", () => {
    const chain = buildFallbackChain(context({ mode: TranscriptionMode.Enhanced }));
    expect(chain).toEqual([TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE]);
  });

  it("preserves inexpensive cloud fallback order after Nemotron", () => {
    const chain = getDefaultProviderChains()[TranscriptionMode.Auto];
    expect(chain.slice(1, 3)).toEqual([
      TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06,
      TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_17,
    ]);
    expect(INEXPENSIVE_CLOUD_PROVIDER_IDS.has(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06)).toBe(true);
  });

  it("appends legacy Groq when configured in automatic mode", () => {
    const chain = buildFallbackChain(context({
      mode: TranscriptionMode.Auto,
      legacyGroqEnabled: true,
    }));
    expect(chain).toContain(TRANSCRIPTION_PROVIDER_IDS.LEGACY_GROQ);
  });

  it("omits legacy Groq when disabled", () => {
    const chain = buildFallbackChain(context({
      mode: TranscriptionMode.Auto,
      legacyGroqEnabled: false,
    }));
    expect(chain).not.toContain(TRANSCRIPTION_PROVIDER_IDS.LEGACY_GROQ);
  });

  it("blocks premium fallback when billing guard disallows escalation", () => {
    const allowed = canFallbackToProvider(
      TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06,
      TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
      { mode: TranscriptionMode.Auto, allowPremiumFallback: false },
    );
    expect(allowed).toBe(false);
  });

  it("allows premium fallback when explicitly permitted", () => {
    const allowed = canFallbackToProvider(
      TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_QWEN_06,
      TRANSCRIPTION_PROVIDER_IDS.GEMINI_TRANSCRIBE,
      { mode: TranscriptionMode.Auto, allowPremiumFallback: true },
    );
    expect(allowed).toBe(true);
  });

  it("never selects cloud providers in offline mode", () => {
    const chain = buildFallbackChain(context({ mode: TranscriptionMode.Offline }));
    expect(chain.every((providerId) => providerId.startsWith("local:"))).toBe(true);
    expect(chain).not.toContain(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON);
  });

  it("prefers local Nemotron when installed and preferLocal is enabled", () => {
    const chain = buildFallbackChain(context({
      mode: TranscriptionMode.Auto,
      preferLocal: true,
      localNemotronInstalled: true,
    }));
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
    expect(chain).toContain(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON);
  });

  it("skips local Nemotron when not installed even with preferLocal", () => {
    const chain = buildFallbackChain(context({
      mode: TranscriptionMode.Auto,
      preferLocal: true,
      localNemotronInstalled: false,
    }));
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.OPENROUTER_NEMOTRON);
    expect(chain).not.toContain(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
  });

  it("includes local Nemotron in offline chain when installed", () => {
    const chain = buildFallbackChain(context({
      mode: TranscriptionMode.Offline,
      localNemotronInstalled: true,
    }));
    expect(chain[0]).toBe(TRANSCRIPTION_PROVIDER_IDS.LOCAL_NEMOTRON);
    expect(chain).toContain(TRANSCRIPTION_PROVIDER_IDS.LOCAL_WHISPER);
  });
});
