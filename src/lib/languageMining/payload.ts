import type { LanguageMiningPayload, MiningPayloadInput } from "./types";

const MAX_CONTEXT_CODE_UNITS = 1500;

export function createLanguageMiningPayload(input: MiningPayloadInput, now = Date.now()): LanguageMiningPayload {
  const context = (input.surroundingContext ?? input.sentenceText ?? input.text).replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXT_CODE_UNITS);
  return {
    ...input,
    payloadVersion: 1,
    frameAvailable: input.frameAvailable ?? false,
    context,
    provenance: { generatedAt: now, fromCache: false, ...input.provenance },
  };
}

export function miningPayloadCanCreateDraft(payload: LanguageMiningPayload): boolean {
  return Boolean(payload.text.trim()) && payload.analysisAvailability !== "failed" && payload.analysisAvailability !== "stale";
}
