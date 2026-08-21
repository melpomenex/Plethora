import type { WritingCorrection, WritingDraft, WritingPrompt, WritingResult } from "./types";

export interface WritingProvider { id: string; version: string; correct(prompt: WritingPrompt, rawText: string, signal?: AbortSignal): Promise<readonly WritingCorrection[]>; }

export class WritingPracticeService {
  constructor(private readonly provider?: WritingProvider) {}
  async correct(prompt: WritingPrompt, rawText: string, signal?: AbortSignal): Promise<WritingResult> {
    if (signal?.aborted) throw new Error("cancelled");
    if (!rawText.trim() || prompt.context.profileId !== prompt.profileId) throw new Error("invalid-writing-input");
    const now = Date.now();
    if (!this.provider) {
      return {
        draft: { id: `writing:${prompt.id}:${now}`, promptId: prompt.id, profileId: prompt.profileId, rawText, corrections: [], privacy: "local-only", createdAt: now, updatedAt: now },
        status: "unavailable",
        error: "no-writing-provider",
      };
    }
    const corrections = await this.provider.correct(prompt, rawText, signal);
    return {
      draft: { id: `writing:${prompt.id}:${now}`, promptId: prompt.id, profileId: prompt.profileId, rawText, corrections, privacy: "local-only", createdAt: now, updatedAt: now },
      status: "ready",
      providerId: this.provider.id,
      providerVersion: this.provider.version,
    };
  }
}

export function acceptWritingCorrection(draft: WritingDraft, correctionId: string): WritingDraft {
  return {
    ...draft,
    corrections: draft.corrections.map((correction) => correction.id === correctionId ? { ...correction, accepted: true } : correction),
    updatedAt: Date.now(),
  };
}
