import type { PracticeComparison, PracticeSource } from "../languagePractice";

export interface DictationPrompt { id: string; profileId: string; text?: string; source: PracticeSource; expectedAnswer: string; hiddenAnswer: boolean; allowPunctuationTolerance: boolean; }
export interface DictationAttempt { id: string; promptId: string; rawAnswer: string; comparison: PracticeComparison; source: PracticeSource; createdAt: number; }
