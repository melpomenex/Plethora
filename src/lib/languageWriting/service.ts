import type { WritingCorrection, WritingDraft, WritingPrompt } from "./types";

export interface WritingProvider { id: string; version: string; correct(prompt: WritingPrompt, rawText: string, signal?: AbortSignal): Promise<readonly WritingCorrection[]>; }

export class WritingPracticeService {
  constructor(private readonly provider?: WritingProvider) {}
  async correct(prompt: WritingPrompt, rawText: string, signal?: AbortSignal): Promise<WritingDraft> {
    if (signal?.aborted) throw new Error("cancelled");
    if (!rawText.trim() || prompt.context.profileId !== prompt.profileId) throw new Error("invalid-writing-input");
    const corrections = this.provider ? await this.provider.correct(prompt, rawText, signal) : [];
    return { id: `writing:${prompt.id}:${Date.now()}`, promptId: prompt.id, profileId: prompt.profileId, rawText, corrections, privacy: "local-only", createdAt: Date.now(), updatedAt: Date.now() };
  }
}
