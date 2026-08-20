import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { LearnerContextBudget, LearnerContextItem, LearnerContextPacket } from "./types";

export interface ContextProfile {
  id: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
}

export interface ContextLexiconRow {
  entryId: string;
  surface: string;
  lemma?: string;
  state: LanguageKnowledgeState;
  evidenceCount: number;
  sourceDocumentId?: string;
}

const DEFAULT_BUDGET: LearnerContextBudget = { maxItems: 24, maxTextCodeUnits: 1200, includeSourceText: false };

function redact(text: string, budget: LearnerContextBudget): string {
  return text.replace(/\s+/g, " ").trim().slice(0, budget.maxTextCodeUnits);
}

/** Deterministically ranks compact learner context; it never loads full lexicon text. */
export function buildLearnerContext(input: {
  profile: ContextProfile;
  lexicon: readonly ContextLexiconRow[];
  currentSource?: { documentId?: string; text: string };
  budget?: Partial<LearnerContextBudget>;
  now?: number;
}): LearnerContextPacket {
  const budget = { ...DEFAULT_BUDGET, ...input.budget };
  const ranked = [...input.lexicon]
    .filter((row) => row.state !== "ignored")
    .sort((left, right) => right.evidenceCount - left.evidenceCount || left.entryId.localeCompare(right.entryId))
    .slice(0, Math.max(0, budget.maxItems));
  const items: LearnerContextItem[] = ranked.map((row) => ({ ...row, redacted: true }));
  const source = input.currentSource && budget.includeSourceText
    ? { documentId: input.currentSource.documentId, text: redact(input.currentSource.text, budget), redacted: true }
    : undefined;
  return {
    schemaVersion: 1,
    profileId: input.profile.id,
    targetLanguage: input.profile.targetLanguage,
    baseLanguage: input.profile.baseLanguage,
    proficiency: input.profile.proficiency,
    items,
    currentSource: source,
    generatedAt: input.now ?? Date.now(),
    freshness: ranked.length < input.lexicon.length ? "partial" : "fresh",
  };
}
