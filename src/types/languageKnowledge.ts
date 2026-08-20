import type { LexiconPage } from "./languageLexicon";

export type LanguageKnowledgeState = "new" | "encountered" | "learning" | "familiar" | "known" | "ignored";
export type KnowledgeStateSource = "encounter" | "manual" | "import" | "undo" | "system";
export type KnowledgeEvidenceKind = "encounter" | "lookup" | "recognition" | "production" | "manual";

export interface LanguageKnowledgeStateSnapshot {
  profileId: string;
  lexicalEntryId: string;
  state: LanguageKnowledgeState;
  manualOverride: boolean;
  overrideActor?: string;
  overrideSource?: KnowledgeStateSource;
  passiveEvidence: number;
  activeEvidence: number;
  lastEvidenceAt?: number;
  updatedAt: number;
  version: number;
}

export interface LanguageKnowledgeStateChange {
  profileId: string;
  entryId: string;
  state: LanguageKnowledgeState;
  source?: KnowledgeStateSource;
  actorId?: string;
  operationId?: string;
}

export interface LanguageKnowledgeEvidenceInput {
  profileId: string;
  entryId: string;
  kind: KnowledgeEvidenceKind;
  confidence?: number;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: number;
}

export interface LanguageKnowledgeEvidenceEvent {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  kind: KnowledgeEvidenceKind;
  confidence?: number;
  sourceId?: string;
  metadata: Record<string, unknown>;
  occurredAt: number;
}

export interface LanguageKnowledgeStateHistory {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  previousState: LanguageKnowledgeState;
  newState: LanguageKnowledgeState;
  source: KnowledgeStateSource;
  actorId?: string;
  operationId: string;
  changedAt: number;
  revertedAt?: number;
}

export interface LanguageMemorizationLinkInput {
  profileId: string;
  entryId: string;
  learningItemId: string;
  relation?: string;
  actorId?: string;
}

export interface LanguageMemorizationLink {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  learningItemId: string;
  relation: string;
  actorId?: string;
  createdAt: number;
}

export interface KnownWordImportRecord {
  word: string;
  languageTag?: string;
  state: LanguageKnowledgeState;
  source?: string;
}

export interface KnownWordImportPreview {
  matchedEntryIds: string[];
  newWords: string[];
  duplicates: string[];
}

export interface LanguageKnowledgeExport {
  schemaVersion: number;
  profileId: string;
  exportedAt: number;
  states: LanguageKnowledgeStateSnapshot[];
  history: LanguageKnowledgeStateHistory[];
  evidence: LanguageKnowledgeEvidenceEvent[];
  memorizationLinks: LanguageMemorizationLink[];
}

export type LanguageKnowledgeHistoryPage = LexiconPage<LanguageKnowledgeStateHistory>;
