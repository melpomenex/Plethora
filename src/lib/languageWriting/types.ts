import type { LearnerContextPacket } from "../languageTutor";
import type { PracticeSource } from "../languagePractice";

export type WritingPromptMode = "current-document" | "interest" | "target-vocabulary" | "target-grammar" | "translation" | "summary" | "answer" | "rewrite" | "dialogue";
export type CorrectionCategory = "grammar" | "word-choice" | "agreement" | "word-order" | "naturalness" | "spelling";

export interface WritingPrompt { id: string; profileId: string; mode: WritingPromptMode; prompt: string; targetLanguage: string; source?: PracticeSource; context: LearnerContextPacket; }
export interface WritingCorrection { id: string; sourceStart: number; sourceEnd: number; learnerText: string; correctedText: string; naturalText?: string; category: CorrectionCategory; explanation: string; confidence: number; accepted: boolean; }
export interface WritingDraft { id: string; promptId: string; profileId: string; rawText: string; corrections: readonly WritingCorrection[]; privacy: "local-only" | "allow-cloud"; createdAt: number; updatedAt: number; }

export type WritingDraftStatus = "ready" | "unavailable" | "failed" | "stale";

export interface WritingResult {
  draft: WritingDraft;
  status: WritingDraftStatus;
  providerId?: string;
  providerVersion?: string;
  error?: string;
}
