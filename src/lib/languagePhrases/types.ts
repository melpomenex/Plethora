import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { SourceAnchor } from "../../types/languageLexicon";

export type PhraseCandidateStatus = "pending" | "accepted" | "dismissed";
export type PhraseObjectKind = "phrase" | "collocation" | "idiom";

export interface PhraseConstituent {
  position: number;
  surface: string;
  normalized: string;
  lexicalEntryId?: string;
}

export interface LanguagePhrase {
  id: string;
  profileId: string;
  languageTag: string;
  objectKind: PhraseObjectKind;
  phraseKey: string;
  normalizedForm: string;
  canonicalForm: string;
  constituents: readonly PhraseConstituent[];
  meaning?: string;
  translation?: string;
  confidence?: number;
  state: LanguageKnowledgeState;
  firstEncounteredAt?: number;
  lastEncounteredAt?: number;
  occurrenceCount: number;
  version: number;
}

export interface PhraseOccurrence {
  id: string;
  profileId: string;
  phraseId: string;
  sourceType: string;
  documentId?: string;
  mediaId?: string;
  sourceAnchor?: SourceAnchor;
  contextText?: string;
  confidence?: number;
  firstSeenAt: number;
  lastSeenAt: number;
  repeatCount: number;
  occurrenceKey: string;
}

export interface PhraseCandidate {
  id: string;
  profileId: string;
  surface: string;
  normalizedForm: string;
  constituents: readonly PhraseConstituent[];
  sourceAnchor?: SourceAnchor;
  confidence: number;
  providerId?: string;
  providerVersion?: string;
  status: PhraseCandidateStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PhraseCandidateInput {
  profileId: string;
  surface: string;
  constituents: readonly PhraseConstituent[];
  sourceAnchor?: SourceAnchor;
  confidence: number;
  providerId?: string;
  providerVersion?: string;
}

export interface PhraseSrsLink {
  profileId: string;
  phraseId: string;
  learningItemId: string;
  relation: "explicit" | "review";
}

export function normalizePhrase(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function phraseKey(profileId: string, languageTag: string, value: string): string {
  return `${profileId}\u001f${languageTag.toLocaleLowerCase()}\u001f${normalizePhrase(value)}`;
}

export function phraseOccurrenceKey(input: Pick<PhraseOccurrence, "phraseId" | "sourceType" | "documentId" | "mediaId" | "sourceAnchor"> & { start?: number; end?: number }): string {
  return [
    input.phraseId,
    input.sourceType,
    input.documentId ?? "-",
    input.mediaId ?? "-",
    JSON.stringify(input.sourceAnchor ?? null),
    input.start ?? "-",
    input.end ?? "-",
  ].join("\u001f");
}
