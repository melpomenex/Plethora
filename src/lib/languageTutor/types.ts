import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { TutorProviderPath } from "./privacy";

export const ALL_TUTOR_MODES = [
  "explain",
  "roleplay",
  "rewrite",
  "grammar",
  "pronunciation",
  "collocation",
  "translate",
  "minimal-pair",
  "conversation",
  "correction",
  "practice",
] as const;

export type TutorMode = (typeof ALL_TUTOR_MODES)[number];
export type TutorAttribution = "grounded" | "generated" | "general";

export interface LearnerContextItem {
  entryId: string;
  surface: string;
  lemma?: string;
  state: LanguageKnowledgeState;
  evidenceCount: number;
  sourceDocumentId?: string;
  redacted: boolean;
}

export interface LearnerLexiconSummary {
  totalEntries: number;
  knownCount: number;
  familiarCount: number;
  learningCount: number;
  encounteredCount: number;
  newCount: number;
}

export interface LearnerContextPacket {
  schemaVersion: 1;
  profileId: string;
  targetLanguage: string;
  baseLanguage: string;
  proficiency?: string;
  items: readonly LearnerContextItem[];
  lexiconSummary?: LearnerLexiconSummary;
  recentEncounters?: readonly string[];
  documents?: readonly string[];
  activitySummary?: { lookupsCount?: number; reviewsCount?: number; activeMinutes?: number };
  currentSource?: { documentId?: string; text: string; redacted: boolean };
  generatedAt: number;
  freshness: "fresh" | "stale" | "partial";
}

export interface LearnerContextBudget {
  maxItems: number;
  maxTextCodeUnits: number;
  includeSourceText: boolean;
}

export interface TutorRequest {
  profileId: string;
  mode: TutorMode;
  message: string;
  context: LearnerContextPacket;
  signal?: AbortSignal;
  privacy?: "local-only" | "allow-cloud";
  allowCloud?: boolean;
  cloudConsent?: boolean | null;
  conversationHistory?: readonly Pick<TutorSessionMessage, "role" | "text">[];
  targetLexicalCoveragePercent?: number;
  correctionLevel?: "minimal" | "important" | "detailed";
}

export interface TutorResponse {
  text: string;
  attribution: TutorAttribution;
  targetEntryIds: readonly string[];
  providerId: string;
  providerVersion: string;
  createdAt: number;
  modelId?: string;
  providerKind?: "ondevice" | "cloud";
  privacyPath?: TutorProviderPath;
  sendsMaterialOffDevice?: boolean;
}

export interface LanguageTutorProvider {
  id: string;
  version: string;
  supports(mode: TutorMode): boolean;
  respond(request: TutorRequest): Promise<TutorResponse>;
}

export interface TutorSessionMessage {
  id: string;
  role: "user" | "tutor";
  text: string;
  attribution?: TutorAttribution;
  createdAt: number;
}
