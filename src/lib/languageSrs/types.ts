import type { SourceAnchor } from "../../types/languageLexicon";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

export type LanguageDraftItemType = "flashcard" | "cloze" | "qa" | "basic";
export type LanguageDraftOrigin = "dictionary-peek" | "phrase" | "sentence" | "mining" | "suggestion";

export interface LanguageDraftProvenance {
  origin: LanguageDraftOrigin;
  profileId: string;
  lexicalEntryId?: string;
  phraseId?: string;
  sentenceId?: string;
  sourceAnchor?: SourceAnchor;
  providerId?: string;
  providerVersion?: string;
  createdAt: number;
}

export interface LanguageLearningDraft {
  draftKey: string;
  itemType: LanguageDraftItemType;
  question: string;
  answer?: string;
  clozeText?: string;
  documentId?: string;
  tags?: string[];
  interactionMetadata?: Record<string, unknown>;
  provenance: LanguageDraftProvenance;
}

export interface LanguageSuggestionInput {
  entryId: string;
  profileId: string;
  state: LanguageKnowledgeState;
  passiveEvidence: number;
  activeEvidence: number;
  encounterCount: number;
  lookupCount: number;
  lastSuggestedAt?: number;
  now?: number;
}

export interface LanguageSuggestionScore {
  eligible: boolean;
  score: number;
  reasons: readonly string[];
  cooldownUntil?: number;
}

export function languageDraftKey(provenance: Pick<LanguageDraftProvenance, "profileId" | "lexicalEntryId" | "phraseId" | "sentenceId">, itemType: LanguageDraftItemType, question: string): string {
  return [provenance.profileId, provenance.lexicalEntryId ?? "-", provenance.phraseId ?? "-", provenance.sentenceId ?? "-", itemType, question.trim().toLocaleLowerCase()].join("\u001f");
}
