/** Frontend contract for the durable, profile-scoped language lexicon. */

export type LexicalObjectKind = "token" | "phrase";
export type OrphanState = "live" | "orphaned" | "retained";

export interface SourceAnchor {
  sourceType: string;
  documentId?: string;
  mediaId?: string;
  sourceId?: string;
  contentFingerprint?: string;
  locator?: unknown;
}

export interface LanguageLexicalEntry {
  id: string;
  profileId: string;
  languageTag: string;
  objectKind: LexicalObjectKind;
  lexicalKey: string;
  normalizedForm: string;
  canonicalForm: string;
  lemma?: string;
  meanings: string[];
  translations: string[];
  partOfSpeech?: string;
  pronunciation?: string;
  frequency?: number;
  cefrLevel?: string;
  providerId?: string;
  providerVersion?: string;
  processorId?: string;
  processorVersion?: string;
  identityConfidence?: number;
  firstEncounteredAt?: number;
  lastEncounteredAt?: number;
  encounterCount: number;
  documentCount: number;
  lookupCount: number;
  activeEvidenceCount: number;
  passiveEvidenceCount: number;
  knowledgeState?: string;
  reviewRelationships: Record<string, unknown>;
  userNotes?: string;
  ignored: boolean;
  properNoun: boolean;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface LanguageSurfaceForm {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  languageTag: string;
  surface: string;
  normalized: string;
  firstSeenAt?: number;
  lastSeenAt?: number;
  occurrenceCount: number;
}

export interface LanguageLexicalAnalysis {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  surfaceFormId?: string;
  tokenId?: string;
  sentenceId?: string;
  processingKey: string;
  processorId?: string;
  processorVersion?: string;
  lemma?: string;
  partOfSpeech?: string;
  morphology: Record<string, unknown>;
  confidence?: number;
  authoritative: boolean;
  createdAt: number;
}

export interface LanguageOccurrence {
  id: string;
  profileId: string;
  lexicalEntryId: string;
  surfaceFormId?: string;
  languageTag: string;
  surface: string;
  normalized: string;
  sourceType: string;
  documentId?: string;
  mediaId?: string;
  sourceId?: string;
  sentenceId?: string;
  tokenId?: string;
  contentFingerprint?: string;
  sourceAnchor?: SourceAnchor;
  contextReference?: string;
  contextHash?: string;
  contextText?: string;
  encounteredAt: number;
  lastEncounteredAt: number;
  repeatCount: number;
  audioStartMs?: number;
  audioEndMs?: number;
  wasLookup: boolean;
  wasInteracted: boolean;
  processingKey?: string;
  confidence?: number;
  orphanState: OrphanState;
  orphanedAt?: number;
  retentionExpiresAt?: number;
  occurrenceKey: string;
}

export interface LexiconPage<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface EncounterInput {
  id?: string;
  profileId: string;
  languageTag: string;
  surface: string;
  normalized?: string;
  lemma?: string;
  objectKind?: LexicalObjectKind;
  canonicalForm?: string;
  partOfSpeech?: string;
  morphology?: Record<string, unknown>;
  processorId?: string;
  processorVersion?: string;
  processingKey?: string;
  confidence?: number;
  sourceAnchor?: SourceAnchor;
  sourceType?: string;
  documentId?: string;
  mediaId?: string;
  sourceId?: string;
  sentenceId?: string;
  tokenId?: string;
  contentFingerprint?: string;
  contextReference?: string;
  contextHash?: string;
  contextText?: string;
  encounteredAt?: number;
  audioStartMs?: number;
  audioEndMs?: number;
  wasLookup?: boolean;
  wasInteracted?: boolean;
  retentionExpiresAt?: number;
}

export interface LookupInput {
  profileId?: string;
  languageTag?: string;
  surface: string;
  documentId?: string;
  mediaId?: string;
  sourceAnchor?: SourceAnchor;
  providerId?: string;
  providerVersion?: string;
  meanings?: string[];
  translations?: string[];
  pronunciation?: string;
  partOfSpeech?: string;
  lookedUpAt?: number;
}

export interface LanguageLookupEvent {
  id: string;
  profileId?: string;
  lexicalEntryId?: string;
  surface: string;
  normalized: string;
  documentId?: string;
  mediaId?: string;
  sourceAnchor?: SourceAnchor;
  lookedUpAt: number;
  providerId?: string;
  providerVersion?: string;
}

export interface LexicalEntryOverride {
  profileId: string;
  entryId: string;
  lemma?: string;
  canonicalForm?: string;
  knowledgeState?: string;
  userNotes?: string;
  ignored?: boolean;
  properNoun?: boolean;
}

export interface EncounterBatchResult {
  accepted: number;
  coalesced: number;
  entries: LanguageLexicalEntry[];
}

export interface LegacyLookupRecord {
  word: string;
  lookupCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastDocumentId?: string;
}

export interface LanguageLexiconExport {
  schemaVersion: number;
  profileId: string;
  exportedAt: number;
  entries: LanguageLexicalEntry[];
  surfaces: LanguageSurfaceForm[];
  analyses: LanguageLexicalAnalysis[];
  occurrences: LanguageOccurrence[];
  lookupEvents: LanguageLookupEvent[];
  occurrencesIncluded: boolean;
  occurrenceOffset: number;
  occurrenceLimit: number;
  occurrenceTotal: number;
}
